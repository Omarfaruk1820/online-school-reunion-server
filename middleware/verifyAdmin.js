// ============================================================
// VERIFY ADMIN
// ============================================================

const verifyAdmin = (req, res, next) => {
  try {
    // --------------------------------------------------------
    // 1. CHECK DATABASE USER
    // --------------------------------------------------------

    if (!req.userData) {
      return res.status(401).json({
        success: false,
        code: "auth/user-missing",
        message: "Authentication required.",
      });
    }

    // --------------------------------------------------------
    // 2. CHECK ACCOUNT STATUS
    // --------------------------------------------------------

    if (req.userData.status !== "active") {
      return res.status(403).json({
        success: false,
        code: "user/inactive",
        message: "Your account is not active.",
      });
    }

    // --------------------------------------------------------
    // 3. CHECK ADMIN ROLE
    // --------------------------------------------------------

    if (req.userData.role !== "admin") {
      return res.status(403).json({
        success: false,
        code: "admin/access-denied",
        message: "Admin access is required.",
      });
    }

    // --------------------------------------------------------
    // 4. ADMIN VERIFIED
    // --------------------------------------------------------

    console.log("VERIFY ADMIN - Admin access granted:", {
      uid: req.userData.uid,
      email: req.userData.email,
      role: req.userData.role,
    });

    // --------------------------------------------------------
    // 5. CONTINUE
    // --------------------------------------------------------

    return next();
  } catch (error) {
    console.error("ADMIN VERIFICATION ERROR:", {
      name: error?.name || "UnknownError",
      message: error?.message || "Unknown error",
      code: error?.code || "UNKNOWN",
    });

    return res.status(500).json({
      success: false,
      code: "admin/verification-failed",
      message: "Failed to verify admin access.",
    });
  }
};

export default verifyAdmin;
