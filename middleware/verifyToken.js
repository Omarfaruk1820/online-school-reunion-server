import firebaseAuth  from "../middleware/verifyAdmin.js";

const verifyToken = async (req, res, next) => {
  try {
    // ========================================================
    // GET AUTHORIZATION HEADER
    // ========================================================

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message: "Authentication token is required.",
      });
    }

    // ========================================================
    // CHECK BEARER TOKEN
    // ========================================================

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "auth/token-invalid",
        message: "Invalid authorization format.",
      });
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message: "Authentication token is required.",
      });
    }

    // ========================================================
    // VERIFY FIREBASE TOKEN
    // ========================================================

    const decodedToken = await firebaseAuth.verifyIdToken(token);

    // ========================================================
    // CHECK UID
    // ========================================================

    if (!decodedToken?.uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated user ID is missing.",
      });
    }

    // ========================================================
    // NORMALIZE FIREBASE USER
    // ========================================================

    const signInProvider =
      decodedToken?.firebase?.sign_in_provider || "password";

    req.user = {
      ...decodedToken,

      uid: decodedToken.uid,

      email: decodedToken.email || null,

      name:
        decodedToken.name ||
        decodedToken.email?.split("@")[0] ||
        "School Member",

      picture: decodedToken.picture || null,

      emailVerified: decodedToken.email_verified === true,

      provider: signInProvider,
    };

    console.log("VERIFY TOKEN - Firebase token verified:", {
      uid: req.user.uid,
      email: req.user.email,
      provider: req.user.provider,
    });

    return next();
  } catch (error) {
    console.error("VERIFY TOKEN ERROR:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    return res.status(401).json({
      success: false,
      code: "auth/token-invalid",
      message: "Invalid or expired authentication token.",
    });
  }
};

export default verifyToken;
