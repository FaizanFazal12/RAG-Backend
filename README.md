# RAG Backend — Chat with your PDFs

A production-style **Retrieval-Augmented Generation (RAG)** backend that lets authenticated users upload PDFs and chat with them. Answers are **grounded in the documents** and returned with **source citations** (file + page). Each chat keeps its own memory and its own private set of documents.

> **Frontend repo:** [RAG-Frontend](https://github.com/FaizanFazal12/RAG-Frontend) — Next.js chat UI that consumes this API.

---

## ✨ Features

- 🔐 **Authentication** — email/password with secure httpOnly cookie sessions ([Better Auth](https://better-auth.com))
- 💬 **Multiple chats per user** — create, list, and resume past conversations (ChatGPT-style)
- 🧠 **Per-chat memory** — conversation history persisted in MongoDB, fed back to the model
- 📄 **PDF ingestion** — async, queue-based processing so uploads never block the API
- 🔎 **Grounded answers with citations** — responses cite the source file and page
- 🛡️ **Per-chat document isolation** — a chat can only retrieve *its own* documents (multi-tenant RAG)
- ⚡ **Background worker** — heavy embedding/indexing runs outside the request cycle

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Runtime / Framework | Node.js, Express 5 |
| LLM | Google **Gemini 2.5 Flash** (via `@langchain/google-genai`) |
| Embeddings | Google **gemini-embedding-001** |
| Vector DB | **Qdrant** |
| Job Queue | **BullMQ** + Valkey/Redis |
| Database | **MongoDB** (Mongoose for app data) |
| Auth | **Better Auth** (MongoDB adapter) |
| PDF parsing | `pdf-parse` via LangChain `PDFLoader` |
| Orchestration | LangChain |

---

## 🏗️ Architecture

```
                          ┌──────────────────────────────────────────┐
                          │                Express API                │
   Upload PDF  ─────────► │  POST /upload/pdf  ──┐                     │
                          │                      │ enqueue job         │
                          │                      ▼                     │
                          │                  BullMQ (Valkey/Redis)     │
                          └──────────────────────┬───────────────────-┘
                                                 │ job
                                                 ▼
                          ┌──────────────────────────────────────────┐
                          │                  Worker                    │
                          │  parse PDF → chunk → embed (Gemini)        │
                          │  tag chunks { userId, chatId, fileName }   │
                          │  store vectors ──────────────► Qdrant      │
                          └────────────────────────────────────────────┘

   Ask question ────────► POST /chat
                          │ 1. verify chat belongs to user (MongoDB)
                          │ 2. embed question
                          │ 3. similarity search in Qdrant
                          │      FILTER: metadata.chatId == this chat
                          │ 4. build prompt (context + chat history)
                          │ 5. Gemini 2.5 Flash → grounded answer
                          │ 6. persist messages (MongoDB)
                          └─► { message, citations:[{source, page}] }
```

### How retrieval stays isolated per chat
All chunks live in **one** Qdrant collection (`rag-gemini`). Each chunk is tagged with its `chatId` at indexing time. At query time we run a **filtered similarity search** so only the current chat's chunks are candidates — other chats' documents are never even considered. Ownership is also enforced first (`Chat.findOne({ _id, userId })`), so users can only ever query their own chats.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Docker (for Qdrant, Valkey, MongoDB)
- A **Google Gemini API key** → [Google AI Studio](https://aistudio.google.com/app/apikey)

### 1. Start infrastructure
```bash
docker compose up -d   # starts qdrant (:6333), valkey (:6379), mongo (:27017)
```

### 2. Install dependencies
```bash
npm install --legacy-peer-deps
```
> `--legacy-peer-deps` is required due to a peer-dependency conflict in `@langchain/community`.

### 3. Configure environment
Copy `.env.example` → `.env` and fill in:
```bash
QDRANT_URL=http://localhost:6333
GOOGLE_API_KEY=your_gemini_api_key
MONGODB_URI=mongodb://localhost:27017/rag
BETTER_AUTH_SECRET=<a long random string>
BETTER_AUTH_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
```
Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run (two terminals)
```bash
npm run dev          # API server on :8000
npm run dev:worker   # background PDF processor
```

---

## 📡 API Reference

### Auth (provided by Better Auth, mounted at `/api/auth/*`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/sign-up/email` | Register `{ name, email, password }` |
| `POST` | `/api/auth/sign-in/email` | Login `{ email, password }` |
| `POST` | `/api/auth/sign-out` | Logout |
| `GET`  | `/api/auth/get-session` | Current session |

### Application routes (require an authenticated session cookie)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/chats` | Create a new chat |
| `GET`  | `/chats` | List the user's chats (newest first) |
| `GET`  | `/chats/:id/messages` | Get a chat's message history |
| `POST` | `/upload/pdf` | Upload a PDF to a chat — form-data: `pdf` (file), `chatId` |
| `POST` | `/chat` | Ask a question — `{ chatId, userQuery }` → `{ message, citations }` |

---

## 📁 Project Structure
```
RAG-Backend/
├── index.js                 # Express app, routes, RAG /chat endpoint
├── worker.js                # BullMQ worker: parse → embed → store
├── lib/
│   ├── auth.js              # Better Auth config (MongoDB, cookies)
│   └── db.js                # Mongoose connection
├── models/
│   ├── Chat.js              # Chat (conversation) schema
│   └── Message.js           # Message schema (per-chat memory)
├── middleware/
│   └── requireAuth.js       # Session validation → req.userId
├── utils/
│   └── qdrant.js            # Embeddings + Qdrant vector store
├── docker-compose.yml       # qdrant + valkey + mongo
└── .env.example
```

---

## 🔐 Authentication model

Better Auth manages four MongoDB collections:
- `user` — profile (name, email)
- `account` — credentials (hashed password / linked OAuth providers)
- `session` — active login sessions
- `verification` — email-verify / reset tokens

Sessions use **httpOnly cookies** — the browser sends them automatically, and the frontend never stores tokens manually. `requireAuth` middleware validates the cookie on protected routes and attaches `req.userId`.

---

## 📝 Notes & Future Work
- Chat history is capped to the last 10 messages per request to control token usage (Gemini free-tier friendly).
- Retrieval uses `k=4` chunks — tunable for recall vs. cost.
- **Roadmap:** streaming responses, Google OAuth, document management (delete/list per chat), rate limiting.

---

## 📄 License
ISC
