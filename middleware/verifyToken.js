import { firebaseAuth } from "../config/firebase.js";

const verifyToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message:
          "Unauthorized: Firebase ID token is required.",
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message:
          "Unauthorized: Firebase ID token is missing.",
      });
    }

    const decodedToken =
      await firebaseAuth.verifyIdToken(token);

    if (!decodedToken?.uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message:
          "Unauthorized: Firebase UID is unavailable.",
      });
    }

    if (!decodedToken?.email) {
      return res.status(401).json({
        success: false,
        code: "auth/email-missing",
        message:
          "Unauthorized: Firebase email is unavailable.",
      });
    }

    req.user = {
      uid: decodedToken.uid,

      email: String(decodedToken.email)
        .trim()
        .toLowerCase(),

      name: decodedToken.name || "",

      picture: decodedToken.picture || "",

      emailVerified:
        decodedToken.email_verified === true,

      provider:
        decodedToken.firebase?.sign_in_provider ||
        "password",
    };

    return next();
  } catch (error) {
    console.error("VERIFY TOKEN ERROR:", {
      code: error?.code || "UNKNOWN",

      message:
        error?.message ||
        "Unknown Firebase authentication error.",

      projectId:
        process.env.FIREBASE_PROJECT_ID || "MISSING",
    });

    return res.status(401).json({
      success: false,
      code: "auth/invalid-token",
      message:
        "Unauthorized: Invalid or expired Firebase ID token.",
    });
  }
};

export default verifyToken;