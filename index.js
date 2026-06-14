const { Queue } = require('bullmq');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { getVectorStore } = require('./utils/qdrant');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { connectDB } = require('./lib/db');
const { auth } = require('./lib/auth');
const { toNodeHandler } = require('better-auth/node');
const { requireAuth } = require('./middleware/requireAuth');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

require('dotenv').config();

const app = express();
const PORT = 8000;

// CORS must allow credentials so the browser sends the auth cookie.
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));

// Mount Better Auth BEFORE express.json() — it needs the raw request body.
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({ storage: storage });

const myQue = new Queue('upload-pdf-queue', {
    connection: { host: 'localhost', port: '6379' },
});

const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    maxRetries: 0,
});

// ---------- Chat management ----------

// Create a new chat
app.post('/chats', requireAuth, async (req, res) => {
    try {
        const chat = await Chat.create({
            userId: req.userId,
            title: req.body.title || 'New Chat',
        });
        res.json(chat);
    } catch (err) {
        console.error('Create chat error:', err);
        res.status(500).json({ message: 'Failed to create chat' });
    }
});

// List the logged-in user's chats (newest first) — for the sidebar
app.get('/chats', requireAuth, async (req, res) => {
    try {
        const chats = await Chat.find({ userId: req.userId }).sort({ updatedAt: -1 });
        res.json(chats);
    } catch (err) {
        console.error('List chats error:', err);
        res.status(500).json({ message: 'Failed to load chats' });
    }
});

// Load a previous chat's messages
app.get('/chats/:id/messages', requireAuth, async (req, res) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, userId: req.userId });
        if (!chat) return res.status(404).json({ message: 'Chat not found' });

        const messages = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        console.error('Load messages error:', err);
        res.status(500).json({ message: 'Failed to load messages' });
    }
});

// ---------- PDF upload (scoped to a chat) ----------

app.post('/upload/pdf', requireAuth, upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No PDF file was uploaded' });
        }

        const { chatId } = req.body;
        const chat = await Chat.findOne({ _id: chatId, userId: req.userId });
        if (!chat) return res.status(404).json({ message: 'Chat not found' });

        await myQue.add('pdf-upload', {
            path: req.file.path,
            originalName: req.file.originalname,
            userId: req.userId,
            chatId: String(chat._id),
        });

        res.json({ message: 'PDF uploaded successfully', file: req.file });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ message: 'Failed to process the uploaded PDF' });
    }
});

// ---------- Chat (RAG, per-chat memory + retrieval) ----------

app.post('/chat', requireAuth, async (req, res) => {
    try {
        const { userQuery, chatId } = req.body;

        if (!userQuery || !userQuery.trim()) {
            return res.status(400).json({ message: 'userQuery is required' });
        }

        const chat = await Chat.findOne({ _id: chatId, userId: req.userId });
        if (!chat) return res.status(404).json({ message: 'Chat not found' });

        const store = await getVectorStore();

        // Retrieve ONLY this chat's documents (per-chat isolation).
        const result = await store.similaritySearch(userQuery, 4, {
            must: [{ key: 'metadata.chatId', match: { value: String(chat._id) } }],
        });

        // Build a readable, source-tagged context block.
        const context = result
            .map((doc, i) => {
                const fileName = doc.metadata?.fileName || 'document';
                const page = doc.metadata?.loc?.pageNumber;
                const tag = page ? `${fileName}, page ${page}` : fileName;
                return `[Source ${i + 1}: ${tag}]\n${doc.pageContent}`;
            })
            .join('\n\n');

        // Deduplicate citations by file + page.
        const seen = new Set();
        const citations = [];
        for (const doc of result) {
            const fileName = doc.metadata?.fileName || 'document';
            const page = doc.metadata?.loc?.pageNumber ?? null;
            const key = `${fileName}#${page}`;
            if (!seen.has(key)) {
                seen.add(key);
                citations.push({ source: fileName, page });
            }
        }

        // Load this chat's prior messages as memory (last 10 for token economy).
        const priorMessages = await Message.find({ chatId: chat._id })
            .sort({ createdAt: 1 })
            .lean();
        const history = priorMessages
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }));

        const SYSTEM_PROMPT = `
You are a helpful AI assistant. Answer the user's question using ONLY the context below, which comes from uploaded PDF files.
If the answer is not in the context, say you could not find it in the documents.
When you use information from a source, mention the file and page (e.g. "according to invoice.pdf, page 3").

Context:
${context}
        `.trim();

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: userQuery },
        ];

        const response = await llm.invoke(messages);
        const assistantText =
            typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);

        // Persist both messages.
        await Message.create({ chatId: chat._id, role: 'user', content: userQuery });
        await Message.create({
            chatId: chat._id,
            role: 'assistant',
            content: assistantText,
            citations,
        });

        // Auto-title the chat from the first user message.
        if (chat.title === 'New Chat') {
            chat.title = userQuery.slice(0, 50);
        }
        await chat.save(); // also bumps updatedAt for sidebar ordering

        return res.json({ message: assistantText, citations });
    } catch (err) {
        console.error('Chat error:', err);

        const status = err?.status || err?.response?.status;
        if (status === 429) {
            return res.status(429).json({
                message: 'Gemini quota/rate limit exceeded. Wait a minute and try again, or enable billing for higher limits.',
                error: err?.message,
            });
        }

        return res.status(500).json({
            message: 'Something went wrong while answering your question',
            error: err?.message,
        });
    }
});

// Start server after DB connects.
connectDB()
    .then(() => {
        app.listen(PORT, () => console.log('Backend is connected to the Port ' + PORT));
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB:', err);
        process.exit(1);
    });
