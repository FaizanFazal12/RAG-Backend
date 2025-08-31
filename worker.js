const { Worker } = require('bullmq');
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf")
const { QdrantVectorStore } = require("@langchain/qdrant");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { getVectorStore } = require('./utils/qdrant');
require('dotenv').config();
const worker = new Worker('upload-pdf-queue', async job => {

    const loader = new PDFLoader(job.data.path);
    const docs = await loader.load();
    // console.log('docs', docs)
    const vectorStore = await getVectorStore();
    // console.log('vectorStore', vectorStore)
    await vectorStore.addDocuments(docs);


}, {
    connection: {
        host: 'localhost',
        port: '6379'
    }
})