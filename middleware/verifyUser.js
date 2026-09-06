const { getCollections } = require("../config/db");

const verifyUser = async (req, res, next) => {
  try {
    // ----------------------------------------------------------
    // Firebase user check
    // ----------------------------------------------------------

    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // ----------------------------------------------------------
    // Collections
    // ----------------------------------------------------------

    const { usersCollection } = getCollections();

    // ----------------------------------------------------------
    // Find MongoDB user
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // User not found
    // ----------------------------------------------------------

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    // ----------------------------------------------------------
    // Account status
    // ----------------------------------------------------------

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    // ----------------------------------------------------------
    // Attach MongoDB user
    // ----------------------------------------------------------

    req.userData = user;

    next();
  } catch (error) {
    console.error("User verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to verify user account.",
    });
  }
};

module.exports = verifyUser;
