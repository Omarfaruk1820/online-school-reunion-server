import { getCollections } from "../config/db.js";

const verifyUser = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { usersCollection } = getCollections();

    const user = await usersCollection.findOne(
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

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    req.userData = user;

    return next();
  } catch (error) {
    console.error("User verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to verify user account.",
    });
  }
};

export default verifyUser;
