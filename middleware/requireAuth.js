const { auth } = require("../lib/auth");
const { fromNodeHeaders } = require("better-auth/node");

// Validates the Better Auth session cookie and attaches the user to the request.
async function requireAuth(req, res, next) {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        if (!session) {
            return res.status(401).json({ message: "Unauthorized. Please log in." });
        }

        req.userId = session.user.id;
        req.user = session.user;
        next();
    } catch (err) {
        console.error("Auth check failed:", err);
        return res.status(401).json({ message: "Unauthorized" });
    }
}

module.exports = { requireAuth };
