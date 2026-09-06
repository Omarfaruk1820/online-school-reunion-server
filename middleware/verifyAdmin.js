const verifyAdmin = (req, res, next) => {
  try {
    if (!req.userData) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (req.userData.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
      });
    }

    if (req.userData.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access is required.",
      });
    }

    return next();
  } catch (error) {
    console.error(
      "Admin verification error:",
      error.message,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to verify admin access.",
    });
  }
};

export default verifyAdmin;