const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { QdrantVectorStore } = require("@langchain/qdrant");
// const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

async function getVectorStore() {
    const embeddings = new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001", // current Gemini embedding model (3072-dim)
        apiKey: process.env.GOOGLE_API_KEY,
    });


   

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        url: process.env.QDRANT_URL,
        collectionName: "rag-gemini",
    });


    return vectorStore;
}

module.exports = { getVectorStore };
