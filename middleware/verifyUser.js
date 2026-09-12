import { getCollections } from "../config/db.js";

const verifyUser = async (req, res, next) => {
  try {
    // ========================================================
    // 1. CHECK AUTHENTICATED USER
    // ========================================================

    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/user-missing",
        message: "Authentication required.",
      });
    }

    console.log("VERIFY USER - Firebase UID:", uid);

    // ========================================================
    // 2. GET COLLECTIONS
    // ========================================================

    const collections = getCollections();

    if (!collections) {
      throw new Error("getCollections() returned undefined.");
    }

    const { users } = collections;

    // ========================================================
    // 3. CHECK USERS COLLECTION
    // ========================================================

    if (!users) {
      throw new Error("Users collection is not initialized.");
    }

    console.log("VERIFY USER - Users collection is available.");

    // ========================================================
    // 4. FIND USER
    // ========================================================

    const user = await users.findOne(
      {
        uid,
      },
      {
        projection: {
          _id: 1,
          uid: 1,
          name: 1,
          email: 1,
          phone: 1,
          photo: 1,
          role: 1,
          status: 1,
          provider: 1,
          emailVerified: 1,
          createdAt: 1,
          updatedAt: 1,
          lastLogin: 1,
          profile: 1,
        },
      },
    );

    console.log("VERIFY USER - MongoDB user found:", Boolean(user));

    // ========================================================
    // 5. USER NOT FOUND
    // ========================================================

    if (!user) {
      return res.status(404).json({
        success: false,
        code: "user/not-found",
        message: "User account not found.",
      });
    }

    // ========================================================
    // 6. CHECK USER STATUS
    // ========================================================

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        code: "user/inactive",
        message: "Your account is not active.",
      });
    }

    // ========================================================
    // 7. ATTACH DATABASE USER
    // ========================================================

    req.userData = user;

    console.log("VERIFY USER - User verification successful:", {
      uid: user.uid,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    return next();
  } catch (error) {
    // ========================================================
    // REAL ERROR
    // ========================================================

    console.error("USER VERIFICATION ERROR:", {
      name: error?.name || "UnknownError",
      message: error?.message || "Unknown error",
      code: error?.code || "UNKNOWN",
      stack: error?.stack || "No stack available",
      uid: req.user?.uid || "UID_MISSING",
    });

    return res.status(500).json({
      success: false,
      code: "user/verification-failed",
      message: "Failed to verify user account.",
    });
  }
};

export default verifyUser;
