const mongoose = require("mongoose");
require("dotenv").config();

async function connectDB() {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not set in .env");
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");
}

module.exports = { connectDB };
