const { Queue } = require('bullmq');
const express = require('express');
const multer = require('multer')
const cors = require('cors')

const app = express();
const PORT = 8000
const path = require('path');
const { getVectorStore } = require('./utils/qdrant');
const OpenAI = require('openai');


app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // use relative uploads folder
    },
    filename: function (req, file, cb) {
        const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    },

});

const upload = multer({ storage: storage })

const myQue = new Queue('upload-pdf-queue', {
    connection: {
        host: 'localhost',
        port: '6379'
    }
})

const client = new OpenAI()
app.post('/upload/pdf', upload.single('pdf'), async (req, res, next) => {

    myQue.add('pdf-upload', {
        destination: req.file.destination,
        path: req.file.path
    })

    res.json({
        message: 'PDF uploaded successfully',
        file: req.file,
    })

})
// ---- Global chat history (shared) ----
let chatHistory = []; 

app.post('/chat', async (req, res) => {
    const { userQuery } = req.body;

    const store = await getVectorStore();
    const retriever = store.asRetriever();
    const result = await retriever.invoke(userQuery);

    const SYSTEM_PROMPT = `
      You are a helpful AI Assistant who answers the user query based on the available context from PDF File.
      Context:
      ${JSON.stringify(result)}
    `;

    // Build messages: system prompt + previous history + latest user query
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...chatHistory,
        { role: 'user', content: userQuery }
    ];

    const chatResult = await client.chat.completions.create({
        model: 'gpt-4.1',
        messages,
    });

    const assistantMessage = chatResult.choices[0].message;

    // Save history
    chatHistory.push({ role: 'user', content: userQuery });
    chatHistory.push(assistantMessage);

    return res.json({
        message: assistantMessage.content,
        docs: result,
        history: chatHistory,
    });
});



app.listen(PORT, () => console.log('Backend is connected to the Port ' + PORT)) 