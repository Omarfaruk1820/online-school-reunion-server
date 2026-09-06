const express = require("express");
const { ObjectId } = require("mongodb");

const verifyToken = require("../middleware/verifyToken");
const verifyUser = require("../middleware/verifyUser");
const verifyAdmin = require("../middleware/verifyAdmin");

const { getCollections } = require("../config/db");

const router = express.Router();

console.log("verifyToken type:", typeof verifyToken);
console.log("verifyUser type:", typeof verifyUser);
console.log("verifyAdmin type:", typeof verifyAdmin);

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const ALLOWED_ROLES = ["student", "admin"];

const ALLOWED_STATUSES = ["active", "inactive", "blocked"];

// ============================================================
// HELPERS
// ============================================================

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePagination(page, limit) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);

  const safePage =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : DEFAULT_PAGE;

  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
}

// ============================================================
// USER PROJECTION
// ============================================================

const USER_PROJECTION = {
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
};

// ============================================================
// POST /users
// CREATE / SYNC CURRENT FIREBASE USER
// ============================================================

router.post("/", verifyToken, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const firebaseUser = req.user;

    // --------------------------------------------------------
    // Firebase identity
    // NEVER trust UID/email from client
    // --------------------------------------------------------

    const uid = firebaseUser?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Firebase user not found.",
      });
    }

    const firebaseEmail = normalizeEmail(firebaseUser.email);

    // --------------------------------------------------------
    // Client profile data
    // role/status are intentionally ignored
    // --------------------------------------------------------

    const { name, phone, photo, profile } = req.body || {};

    const cleanName = cleanString(name);
    const cleanPhone = cleanString(phone);
    const cleanPhoto = cleanString(photo);

    // --------------------------------------------------------
    // Provider must come from Firebase token
    // --------------------------------------------------------

    const firebaseProvider = firebaseUser.firebase?.sign_in_provider;

    let provider = "password";

    if (firebaseProvider === "google.com") {
      provider = "google";
    } else if (firebaseProvider) {
      provider = firebaseProvider;
    }

    // --------------------------------------------------------
    // Find existing user
    // --------------------------------------------------------

    const existingUser = await usersCollection.findOne({
      uid,
    });

    // ========================================================
    // UPDATE EXISTING USER
    // ========================================================

    if (existingUser) {
      const updateData = {
        email: firebaseEmail || existingUser.email || "",

        name:
          cleanName ||
          existingUser.name ||
          firebaseUser.name ||
          "School Member",

        phone: cleanPhone || existingUser.phone || "",

        photo: cleanPhoto || existingUser.photo || firebaseUser.picture || "",

        provider: existingUser.provider || provider,

        emailVerified:
          firebaseUser.email_verified ?? existingUser.emailVerified ?? false,

        lastLogin: new Date(),

        updatedAt: new Date(),
      };

      // ------------------------------------------------------
      // Update profile only when supplied
      // ------------------------------------------------------

      if (profile && typeof profile === "object" && !Array.isArray(profile)) {
        updateData.profile = profile;
      }

      await usersCollection.updateOne(
        { uid },
        {
          $set: updateData,
        },
      );

      const updatedUser = await usersCollection.findOne(
        { uid },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User synchronized successfully.",
        user: updatedUser,
      });
    }

    // ========================================================
    // CREATE NEW USER
    // ========================================================

    const now = new Date();

    const newUser = {
      uid,

      name: cleanName || firebaseUser.name || "School Member",

      email: firebaseEmail,

      phone: cleanPhone,

      photo: cleanPhoto || firebaseUser.picture || "",

      provider,

      // ------------------------------------------------------
      // SERVER CONTROLLED
      // ------------------------------------------------------

      role: "student",

      status: "active",

      emailVerified: firebaseUser.email_verified || false,

      profile:
        profile && typeof profile === "object" && !Array.isArray(profile)
          ? profile
          : {},

      createdAt: now,

      updatedAt: now,

      lastLogin: now,
    };

    const result = await usersCollection.insertOne(newUser);

    const createdUser = await usersCollection.findOne(
      {
        _id: result.insertedId,
      },
      {
        projection: USER_PROJECTION,
      },
    );

    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      user: createdUser,
    });
  } catch (error) {
    console.error("POST /users error:", error);

    // --------------------------------------------------------
    // MongoDB duplicate key
    // --------------------------------------------------------

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "User already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to synchronize user.",
    });
  }
});

// ============================================================
// GET /users
// ADMIN: GET ALL USERS
//
// Example:
// GET /api/users?page=1&limit=10&search=&sort=newest
// ============================================================

router.get("/", verifyToken, verifyUser, verifyAdmin, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const { page, limit, skip } = parsePagination(
      req.query.page,
      req.query.limit,
    );

    const search = cleanString(req.query.search);

    const sort = cleanString(req.query.sort) || "newest";

    // --------------------------------------------------------
    // Build query
    // --------------------------------------------------------

    const query = {};

    if (search) {
      const safeSearch = escapeRegex(search);

      query.$or = [
        {
          name: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          email: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          uid: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    // --------------------------------------------------------
    // Sorting
    // --------------------------------------------------------

    let sortOption = {
      createdAt: -1,
    };

    if (sort === "oldest") {
      sortOption = {
        createdAt: 1,
      };
    }

    if (sort === "name-asc") {
      sortOption = {
        name: 1,
      };
    }

    if (sort === "name-desc") {
      sortOption = {
        name: -1,
      };
    }

    if (sort === "last-login") {
      sortOption = {
        lastLogin: -1,
      };
    }

    // --------------------------------------------------------
    // Count + data
    // --------------------------------------------------------

    const [totalUsers, users] = await Promise.all([
      usersCollection.countDocuments(query),

      usersCollection
        .find(query, {
          projection: USER_PROJECTION,
        })
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    const totalPages = Math.ceil(totalUsers / limit);

    return res.status(200).json({
      success: true,

      users,

      pagination: {
        total: totalUsers,
        page,
        limit,
        totalPages,

        hasNextPage: page < totalPages,

        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("GET /users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get users.",
    });
  }
});

// ============================================================
// GET /users/:email
// GET SINGLE USER
//
// Admin:
//   Can access any user.
//
// Normal user:
//   Can access only their own account.
// ============================================================

router.get("/:email", verifyToken, verifyUser, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const requestedEmail = normalizeEmail(req.params.email);

    if (!requestedEmail) {
      return res.status(400).json({
        success: false,
        message: "Valid email is required.",
      });
    }

    const currentUser = req.userData;

    const isAdmin = currentUser.role === "admin";

    // --------------------------------------------------------
    // Normal user can only access own account
    // --------------------------------------------------------

    if (!isAdmin && normalizeEmail(currentUser.email) !== requestedEmail) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this user.",
      });
    }

    const user = await usersCollection.findOne(
      {
        email: requestedEmail,
      },
      {
        projection: USER_PROJECTION,
      },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("GET /users/:email error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get user.",
    });
  }
});

// ============================================================
// PATCH /users/:id/role
// ADMIN: CHANGE USER ROLE
// ============================================================

router.patch(
  "/:id/role",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { usersCollection } = getCollections();

      const { id } = req.params;

      // --------------------------------------------------------
      // Validate MongoDB ObjectId
      // --------------------------------------------------------

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      const { role } = req.body || {};

      if (typeof role !== "string" || !ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
        });
      }

      // --------------------------------------------------------
      // Prevent admin from changing own role
      // --------------------------------------------------------

      const targetUser = await usersCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot change your own role.",
        });
      }

      // --------------------------------------------------------
      // Update role
      // --------------------------------------------------------

      await usersCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            role,
            updatedAt: new Date(),
          },
        },
      );

      const updatedUser = await usersCollection.findOne(
        {
          _id: new ObjectId(id),
        },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User role updated successfully.",
        user: updatedUser,
      });
    } catch (error) {
      console.error("PATCH /users/:id/role error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update user role.",
      });
    }
  },
);

// ============================================================
// PATCH /users/:id/status
// ADMIN: CHANGE USER STATUS
// ============================================================

router.patch(
  "/:id/status",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { usersCollection } = getCollections();

      const { id } = req.params;

      // --------------------------------------------------------
      // Validate ID
      // --------------------------------------------------------

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      const { status } = req.body || {};

      if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed statuses: ${ALLOWED_STATUSES.join(
            ", ",
          )}.`,
        });
      }

      // --------------------------------------------------------
      // Find target user
      // --------------------------------------------------------

      const targetUser = await usersCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // --------------------------------------------------------
      // Prevent admin from disabling own account
      // --------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot change your own account status.",
        });
      }

      // --------------------------------------------------------
      // Update status
      // --------------------------------------------------------

      await usersCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        },
      );

      const updatedUser = await usersCollection.findOne(
        {
          _id: new ObjectId(id),
        },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User status updated successfully.",
        user: updatedUser,
      });
    } catch (error) {
      console.error("PATCH /users/:id/status error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update user status.",
      });
    }
  },
);

// ============================================================
// DELETE /users/:id
// ADMIN: DELETE USER
// ============================================================

router.delete(
  "/:id",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { usersCollection } = getCollections();

      const { id } = req.params;

      // --------------------------------------------------------
      // Validate ID
      // --------------------------------------------------------

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      // --------------------------------------------------------
      // Find target user
      // --------------------------------------------------------

      const targetUser = await usersCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // --------------------------------------------------------
      // Prevent admin self-delete
      // --------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot delete your own account.",
        });
      }

      // --------------------------------------------------------
      // Delete user
      // --------------------------------------------------------

      const result = await usersCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "User could not be deleted.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User deleted successfully.",
      });
    } catch (error) {
      console.error("DELETE /users/:id error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete user.",
      });
    }
  },
);

module.exports = router;
