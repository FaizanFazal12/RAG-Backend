const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { MongoClient } = require("mongodb");
require("dotenv").config();

// Better Auth uses the native MongoDB driver. The driver connects lazily on
// first query, so we don't need to await connect() here.
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db(); // database name comes from the URI

const isProd = process.env.NODE_ENV === "production";

const auth = betterAuth({
    database: mongodbAdapter(db),
    emailAndPassword: { enabled: true },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:8000",
    trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:3000"],
    advanced: {
        defaultCookieAttributes: {
            // Localhost dev: FE/BE are same-site (different ports) so "lax" works.
            // Production with different domains: needs "none" + secure (both over HTTPS).
            sameSite: isProd ? "none" : "lax",
            secure: isProd,
        },
    },
});

module.exports = { auth };
