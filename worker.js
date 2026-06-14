const fs = require('fs');
const { Worker } = require('bullmq');
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf")
const { getVectorStore } = require('./utils/qdrant');
require('dotenv').config();

const worker = new Worker('upload-pdf-queue', async job => {

    // Skip stale jobs whose file was removed (avoids ENOENT crash loops).
    if (!fs.existsSync(job.data.path)) {
        console.warn(`Skipping job ${job.id}: file not found at ${job.data.path}`);
        return;
    }

    const loader = new PDFLoader(job.data.path);
    const docs = await loader.load();

    // PDFLoader already sets metadata.loc.pageNumber for each chunk.
    // Add the filename (for citations) + userId/chatId (for per-chat retrieval isolation).
    for (const doc of docs) {
        doc.metadata.fileName = job.data.originalName || doc.metadata.source;
        doc.metadata.userId = job.data.userId;
        doc.metadata.chatId = job.data.chatId;
    }

    const vectorStore = await getVectorStore();
    await vectorStore.addDocuments(docs);

    console.log(`Indexed ${docs.length} pages from ${job.data.originalName}`);

}, {
    connection: {
        host: 'localhost',
        port: '6379'
    }
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
});