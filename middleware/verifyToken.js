const { firebaseAuth } = require("../config/firebase");

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization header is required.",
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format.",
      });
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing.",
      });
    }

    const decodedToken = await firebaseAuth.verifyIdToken(token);

    req.user = decodedToken;

    return next();
  } catch (error) {
    console.error("Token verification failed:", error.message);

    return res.status(401).json({
      success: false,
      message: "Authentication failed.",
    });
  }
}

/*
|--------------------------------------------------------------------------
| CommonJS compatible export
|--------------------------------------------------------------------------
| Supports:
| const verifyToken = require(...)
|
| and:
| const { verifyToken } = require(...)
|--------------------------------------------------------------------------
*/

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
