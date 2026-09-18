import admin from "firebase-admin";

// ============================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is missing.");
  }

  if (!clientEmail) {
    throw new Error("FIREBASE_CLIENT_EMAIL is missing.");
  }

  if (!privateKey) {
    throw new Error("FIREBASE_PRIVATE_KEY is missing.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  console.log("Firebase Admin initialized successfully.");
}

// ============================================================
// FIREBASE AUTH
// ============================================================

const firebaseAuth = admin.auth();

// ============================================================
// VERIFY FIREBASE ID TOKEN
// ============================================================

const verifyToken = async (req, res, next) => {
  try {
    // --------------------------------------------------------
    // 1. GET AUTHORIZATION HEADER
    // --------------------------------------------------------

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message: "Authentication token is required.",
      });
    }

    // --------------------------------------------------------
    // 2. CHECK BEARER FORMAT
    // --------------------------------------------------------

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "auth/token-invalid",
        message: "Invalid authorization format.",
      });
    }

    // --------------------------------------------------------
    // 3. EXTRACT TOKEN
    // --------------------------------------------------------

    const token = authHeader.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "auth/token-missing",
        message: "Authentication token is required.",
      });
    }

    // --------------------------------------------------------
    // 4. VERIFY FIREBASE ID TOKEN
    // --------------------------------------------------------

    const decodedToken = await firebaseAuth.verifyIdToken(token);

    if (!decodedToken?.uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated user ID is missing.",
      });
    }

    // --------------------------------------------------------
    // 5. DETECT FIREBASE SIGN-IN PROVIDER
    // --------------------------------------------------------

    const firebaseProvider =
      decodedToken?.firebase?.sign_in_provider || "password";

    // --------------------------------------------------------
    // 6. NORMALIZE PROVIDER
    // --------------------------------------------------------

    let provider = firebaseProvider;

    if (firebaseProvider === "google.com") {
      provider = "google";
    } else if (firebaseProvider === "password") {
      provider = "password";
    }

    // --------------------------------------------------------
    // 7. CREATE NORMALIZED REQUEST USER
    // --------------------------------------------------------

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

      provider,
    };

    // --------------------------------------------------------
    // 8. LOG SUCCESS
    // --------------------------------------------------------

    console.log("VERIFY TOKEN - Firebase token verified:", {
      uid: req.user.uid,
      email: req.user.email,
      provider: req.user.provider,
    });

    // --------------------------------------------------------
    // 9. CONTINUE
    // --------------------------------------------------------

    return next();
  } catch (error) {
    console.error("VERIFY TOKEN ERROR:", {
      name: error?.name || "UnknownError",
      message: error?.message || "Unknown error",
      code: error?.code || "UNKNOWN",
      codeName: error?.codeName || "UNKNOWN",
    });

    return res.status(401).json({
      success: false,
      code: "auth/token-invalid",
      message: "Invalid or expired authentication token.",
    });
  }
};

export default verifyToken;
