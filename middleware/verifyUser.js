import { getCollections } from "../config/db.js";

// ============================================================
// VERIFY DATABASE USER
// ============================================================

const verifyUser = async (req, res, next) => {
  try {
    // --------------------------------------------------------
    // 1. GET FIREBASE UID
    // --------------------------------------------------------

    const uid = req.user?.uid;

    if (!uid) {
      console.error("VERIFY USER - Firebase UID missing.");

      return res.status(401).json({
        success: false,
        code: "auth/user-missing",
        message: "Authentication required.",
      });
    }

    console.log("VERIFY USER - Firebase UID:", uid);

    // --------------------------------------------------------
    // 2. GET MONGODB COLLECTIONS
    // --------------------------------------------------------

    const { users } = getCollections();

    // --------------------------------------------------------
    // 3. CHECK USERS COLLECTION
    // --------------------------------------------------------

    if (!users) {
      console.error("VERIFY USER - Users collection is not initialized.");

      return res.status(500).json({
        success: false,
        code: "database/users-not-ready",
        message: "Users collection is not ready.",
      });
    }

    console.log("VERIFY USER - Users collection is available.");

    // --------------------------------------------------------
    // 4. FIND USER BY FIREBASE UID
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // 5. USER NOT FOUND
    // --------------------------------------------------------

    if (!user) {
      return res.status(404).json({
        success: false,
        code: "user/not-found",
        message: "User account not found.",
      });
    }

    // --------------------------------------------------------
    // 6. CHECK USER STATUS
    // --------------------------------------------------------

    if (user.status !== "active") {
      console.warn("VERIFY USER - User is not active:", {
        uid: user.uid,
        status: user.status,
      });

      return res.status(403).json({
        success: false,
        code: "user/inactive",
        message: "Your account is not active.",
      });
    }

    // --------------------------------------------------------
    // 7. ATTACH DATABASE USER
    // --------------------------------------------------------

    req.userData = user;

    // --------------------------------------------------------
    // 8. LOG SUCCESS
    // --------------------------------------------------------

    console.log("VERIFY USER - User verification successful:", {
      uid: user.uid,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    // --------------------------------------------------------
    // 9. CONTINUE
    // --------------------------------------------------------

    return next();
  } catch (error) {
    console.error("USER VERIFICATION ERROR:", {
      name: error?.name || "UnknownError",
      message: error?.message || "Unknown error",
      code: error?.code || "UNKNOWN",
      codeName: error?.codeName || "UNKNOWN",
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
