const { firebaseAuth } = require("../config/firebase");

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // ----------------------------------------------------------
    // Authorization header check
    // ----------------------------------------------------------

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization header is required.",
      });
    }

    // ----------------------------------------------------------
    // Bearer check
    // ----------------------------------------------------------

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format.",
      });
    }

    // ----------------------------------------------------------
    // Extract token
    // ----------------------------------------------------------

    const token = authHeader.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing.",
      });
    }

    // ----------------------------------------------------------
    // Verify Firebase ID Token
    // ----------------------------------------------------------

    const decodedToken = await firebaseAuth.verifyIdToken(token);

    // ----------------------------------------------------------
    // Attach Firebase user to request
    // ----------------------------------------------------------

    req.user = decodedToken;

    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);

    return res.status(401).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

module.exports = verifyToken;
