import { getCollections } from "../config/db.js";

const verifyUser = async (req, res, next) => {
  try {
    // ========================================================
    // CHECK AUTHENTICATED USER
    // ========================================================

    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // ========================================================
    // GET USERS COLLECTION
    // ========================================================

    const { users } = getCollections();

    // ========================================================
    // FIND USER
    // ========================================================

    const user = await users.findOne(
      {
        uid: req.user.uid,
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

    // ========================================================
    // USER NOT FOUND
    // ========================================================

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    // ========================================================
    // CHECK USER STATUS
    // ========================================================

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    // ========================================================
    // ATTACH DATABASE USER
    // ========================================================

    req.userData = user;

    return next();
  } catch (error) {
    console.error("User verification error:", {
      message: error?.message || "Unknown error",
      code: error?.code || "UNKNOWN",
    });

    return res.status(500).json({
      success: false,
      message: "Failed to verify user account.",
    });
  }
};

export default verifyUser;
