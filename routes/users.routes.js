import express from "express";
import { ObjectId } from "mongodb";

import verifyToken from "../middleware/verifyToken.js";
import verifyUser from "../middleware/verifyUser.js";
import verifyAdmin from "../middleware/verifyAdmin.js";

import { getCollections } from "../config/db.js";

const router = express.Router();

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const ALLOWED_ROLES = ["student", "admin"];

const ALLOWED_STATUSES = ["active", "inactive", "blocked"];

const PHONE_REGEX = /^01[3-9]\d{8}$/;

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

function isValidObjectId(id) {
  return typeof id === "string" && ObjectId.isValid(id);
}

function isValidBangladeshiPhone(phone) {
  return PHONE_REGEX.test(phone);
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
// SANITIZE USER
// ============================================================

function sanitizeUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  const sanitizedUser = {
    ...user,
  };

  // ----------------------------------------------------------
  // Never expose empty/null photo
  // ----------------------------------------------------------

  const cleanPhoto = cleanString(sanitizedUser.photo);

  if (cleanPhoto) {
    sanitizedUser.photo = cleanPhoto;
  } else {
    delete sanitizedUser.photo;
  }

  // ----------------------------------------------------------
  // Phone handling
  //
  // IMPORTANT:
  // - Actual phone remains unchanged.
  // - Google user may legitimately have null phone.
  // - We do NOT convert null into empty string.
  // ----------------------------------------------------------

  if (sanitizedUser.phone !== null && typeof sanitizedUser.phone !== "string") {
    delete sanitizedUser.phone;
  }

  return sanitizedUser;
}

function sanitizeUsers(users) {
  if (!Array.isArray(users)) {
    return [];
  }

  return users.map(sanitizeUser);
}

// ============================================================
// POST /api/users
// CREATE / SYNCHRONIZE USER
// ============================================================

router.post("/", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    const firebaseUser = req.user;

    // --------------------------------------------------------
    // Firebase identity
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
    // --------------------------------------------------------

    const { name, phone, photo, profile } = req.body || {};

    const cleanName = cleanString(name);
    const cleanPhone = cleanString(phone);
    const cleanPhoto = cleanString(photo);

    // --------------------------------------------------------
    // Provider
    //
    // Provider is determined from Firebase identity.
    // We do not trust the client to decide it.
    // --------------------------------------------------------

    const firebaseProvider = cleanString(firebaseUser.provider);

    const provider =
      firebaseProvider === "google.com"
        ? "google"
        : firebaseProvider || "password";

    const isGoogleProvider = provider === "google";

    // ========================================================
    // VALIDATE NAME
    // ========================================================

    if (cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name cannot exceed 100 characters.",
      });
    }

    // ========================================================
    // VALIDATE PHONE
    // ========================================================

    /*
     * EMAIL/PASSWORD:
     * Phone is REQUIRED.
     *
     * GOOGLE:
     * Phone is OPTIONAL.
     *
     * Therefore:
     *
     * password + empty phone
     *        => 400
     *
     * google + empty phone
     *        => allowed
     *
     * google + valid phone
     *        => allowed
     */

    if (!isGoogleProvider && !cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    // If a phone number is provided, it must always be valid.
    if (cleanPhone && !isValidBangladeshiPhone(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Bangladeshi phone number.",
      });
    }

    // ========================================================
    // VALIDATE PHOTO
    // ========================================================

    if (cleanPhoto.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Photo URL is too long.",
      });
    }

    // ========================================================
    // VALIDATE PROFILE
    // ========================================================

    if (
      profile !== undefined &&
      (profile === null ||
        typeof profile !== "object" ||
        Array.isArray(profile))
    ) {
      return res.status(400).json({
        success: false,
        message: "Profile must be a valid object.",
      });
    }

    // ========================================================
    // FIND EXISTING USER
    // ========================================================

    const existingUser = await users.findOne({
      uid,
    });

    // ========================================================
    // UPDATE EXISTING USER
    // ========================================================

    if (existingUser) {
      const now = new Date();

      const existingPhone =
        typeof existingUser.phone === "string" ? existingUser.phone.trim() : "";

      const updateOperation = {
        $set: {
          email: firebaseEmail || existingUser.email || "",

          name:
            cleanName ||
            existingUser.name ||
            cleanString(firebaseUser.name) ||
            "School Member",

          provider: existingUser.provider || provider,

          emailVerified: firebaseUser.emailVerified === true,

          lastLogin: now,

          updatedAt: now,
        },
      };

      // ------------------------------------------------------
      // PHONE
      // ------------------------------------------------------

      /*
       * IMPORTANT:
       *
       * If Google login does not provide a phone:
       *
       * cleanPhone = ""
       *
       * We DO NOT overwrite an existing phone.
       *
       * Example:
       *
       * Existing user:
       * phone: "01822637989"
       *
       * Google login:
       * phone: ""
       *
       * Result:
       * phone remains "01822637989"
       *
       * If the existing Google user has no phone:
       * phone remains null.
       */

      if (cleanPhone) {
        updateOperation.$set.phone = cleanPhone;
      }

      // ------------------------------------------------------
      // PHOTO
      // ------------------------------------------------------

      if (cleanPhoto) {
        updateOperation.$set.photo = cleanPhoto;
      } else if (existingUser.photo && cleanString(existingUser.photo)) {
        updateOperation.$set.photo = cleanString(existingUser.photo);
      } else if (firebaseUser.picture && cleanString(firebaseUser.picture)) {
        updateOperation.$set.photo = cleanString(firebaseUser.picture);
      } else {
        updateOperation.$unset = {
          photo: "",
        };
      }

      // ------------------------------------------------------
      // PROFILE
      // ------------------------------------------------------

      if (profile && typeof profile === "object" && !Array.isArray(profile)) {
        updateOperation.$set.profile = profile;
      }

      // ------------------------------------------------------
      // IMPORTANT:
      //
      // If this is an existing manual/password user and the
      // database already contains an actual phone, never remove it.
      //
      // If this is an existing Google user with null phone and
      // no new phone is provided, null remains untouched.
      // ------------------------------------------------------

      if (!cleanPhone && !isGoogleProvider && !existingPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required.",
        });
      }

      // ------------------------------------------------------
      // MongoDB update
      // ------------------------------------------------------

      await users.updateOne(
        {
          uid,
        },
        updateOperation,
      );

      // ------------------------------------------------------
      // Get updated user
      // ------------------------------------------------------

      const updatedUser = await users.findOne(
        {
          uid,
        },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User synchronized successfully.",
        user: sanitizeUser(updatedUser),
      });
    }

    // ========================================================
    // CREATE NEW USER
    // ========================================================

    /*
     * For a NEW password user:
     *
     * phone must exist.
     *
     * For a NEW Google user:
     *
     * phone can be empty.
     */

    if (!isGoogleProvider && !cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    const now = new Date();

    const newUser = {
      uid,

      /*
       * Email should normally exist because Firebase
       * authentication provides it.
       */
      email: firebaseEmail || null,

      name: cleanName || cleanString(firebaseUser.name) || "School Member",

      /*
       * IMPORTANT:
       *
       * Manual registration:
       * phone: "01822637989"
       *
       * Google without phone:
       * phone: null
       *
       * Google with phone:
       * phone: "01822637989"
       */
      phone: cleanPhone || null,

      provider,

      role: "student",

      status: "active",

      emailVerified: firebaseUser.emailVerified === true,

      profile:
        profile && typeof profile === "object" && !Array.isArray(profile)
          ? profile
          : {},

      createdAt: now,

      updatedAt: now,

      lastLogin: now,
    };

    // --------------------------------------------------------
    // Add photo only if available
    // --------------------------------------------------------

    if (cleanPhoto) {
      newUser.photo = cleanPhoto;
    } else if (firebaseUser.picture && cleanString(firebaseUser.picture)) {
      newUser.photo = cleanString(firebaseUser.picture);
    }

    // --------------------------------------------------------
    // Insert user
    // --------------------------------------------------------

    const result = await users.insertOne(newUser);

    const createdUser = await users.findOne(
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
      user: sanitizeUser(createdUser),
    });
  } catch (error) {
    console.error("POST /api/users error:", error);

    // --------------------------------------------------------
    // Duplicate key
    // --------------------------------------------------------

    if (error?.code === 11000) {
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
// GET /api/users
// ADMIN: GET USERS
// ============================================================

router.get("/", verifyToken, verifyUser, verifyAdmin, async (req, res) => {
  try {
    const { users } = getCollections();

    // --------------------------------------------------------
    // Pagination
    // --------------------------------------------------------

    const { page, limit, skip } = parsePagination(
      req.query.page,
      req.query.limit,
    );

    // --------------------------------------------------------
    // Search
    // --------------------------------------------------------

    const search = cleanString(req.query.search);

    const sort = cleanString(req.query.sort) || "newest";

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

    switch (sort) {
      case "oldest":
        sortOption = {
          createdAt: 1,
        };
        break;

      case "name-asc":
        sortOption = {
          name: 1,
        };
        break;

      case "name-desc":
        sortOption = {
          name: -1,
        };
        break;

      case "last-login":
        sortOption = {
          lastLogin: -1,
        };
        break;

      case "newest":
      default:
        sortOption = {
          createdAt: -1,
        };
        break;
    }

    // --------------------------------------------------------
    // Count + users
    // --------------------------------------------------------

    const [totalUsers, userList] = await Promise.all([
      users.countDocuments(query),

      users
        .find(query, {
          projection: USER_PROJECTION,
        })
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    const totalPages = totalUsers === 0 ? 0 : Math.ceil(totalUsers / limit);

    return res.status(200).json({
      success: true,

      users: sanitizeUsers(userList),

      pagination: {
        total: totalUsers,
        page,
        limit,
        totalPages,

        hasNextPage: page < totalPages,

        hasPreviousPage: page > 1 && totalPages > 0,
      },
    });
  } catch (error) {
    console.error("GET /api/users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get users.",
    });
  }
});

// ============================================================
// GET /api/users/:email
// GET CURRENT USER / ADMIN USER
// ============================================================

router.get("/:email", verifyToken, verifyUser, async (req, res) => {
  try {
    const { users } = getCollections();

    const requestedEmail = normalizeEmail(req.params.email);

    if (!requestedEmail) {
      return res.status(400).json({
        success: false,
        message: "Valid email is required.",
      });
    }

    const currentUser = req.userData;

    const isAdmin = currentUser?.role === "admin";

    // --------------------------------------------------------
    // Normal user can only access own account
    // --------------------------------------------------------

    if (!isAdmin && normalizeEmail(currentUser?.email) !== requestedEmail) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this user.",
      });
    }

    // --------------------------------------------------------
    // Find user
    // --------------------------------------------------------

    const user = await users.findOne(
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
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("GET /api/users/:email error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get user.",
    });
  }
});

// ============================================================
// PATCH /api/users/:id/role
// ADMIN: CHANGE USER ROLE
// ============================================================

router.patch(
  "/:id/role",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      const { id } = req.params;

      // ------------------------------------------------------
      // Validate ObjectId
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // Validate role
      // ------------------------------------------------------

      const role = cleanString(req.body?.role);

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
        });
      }

      // ------------------------------------------------------
      // Find target user
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // Prevent self role change
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot change your own role.",
        });
      }

      // ------------------------------------------------------
      // No unnecessary update
      // ------------------------------------------------------

      if (targetUser.role === role) {
        return res.status(200).json({
          success: true,
          message: "User already has this role.",
          user: sanitizeUser(targetUser),
        });
      }

      // ------------------------------------------------------
      // Update role
      // ------------------------------------------------------

      await users.updateOne(
        {
          _id: objectId,
        },
        {
          $set: {
            role,
            updatedAt: new Date(),
          },
        },
      );

      // ------------------------------------------------------
      // Get updated user
      // ------------------------------------------------------

      const updatedUser = await users.findOne(
        {
          _id: objectId,
        },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User role updated successfully.",
        user: sanitizeUser(updatedUser),
      });
    } catch (error) {
      console.error("PATCH /api/users/:id/role error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update user role.",
      });
    }
  },
);

// ============================================================
// PATCH /api/users/:id/status
// ADMIN: CHANGE USER STATUS
// ============================================================

router.patch(
  "/:id/status",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      const { id } = req.params;

      // ------------------------------------------------------
      // Validate ObjectId
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // Validate status
      // ------------------------------------------------------

      const status = cleanString(req.body?.status);

      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed statuses: ${ALLOWED_STATUSES.join(
            ", ",
          )}.`,
        });
      }

      // ------------------------------------------------------
      // Find target user
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // Prevent self status change
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot change your own account status.",
        });
      }

      // ------------------------------------------------------
      // No unnecessary update
      // ------------------------------------------------------

      if (targetUser.status === status) {
        return res.status(200).json({
          success: true,
          message: "User already has this account status.",
          user: sanitizeUser(targetUser),
        });
      }

      // ------------------------------------------------------
      // Update status
      // ------------------------------------------------------

      await users.updateOne(
        {
          _id: objectId,
        },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        },
      );

      // ------------------------------------------------------
      // Get updated user
      // ------------------------------------------------------

      const updatedUser = await users.findOne(
        {
          _id: objectId,
        },
        {
          projection: USER_PROJECTION,
        },
      );

      return res.status(200).json({
        success: true,
        message: "User status updated successfully.",
        user: sanitizeUser(updatedUser),
      });
    } catch (error) {
      console.error("PATCH /api/users/:id/status error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update user status.",
      });
    }
  },
);

// ============================================================
// DELETE /api/users/:id
// ADMIN: DELETE USER
// ============================================================

router.delete(
  "/:id",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      const { id } = req.params;

      // ------------------------------------------------------
      // Validate ObjectId
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // Find target user
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // Prevent admin from deleting own account
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "You cannot delete your own account.",
        });
      }

      // ------------------------------------------------------
      // Delete MongoDB user
      // ------------------------------------------------------

      const result = await users.deleteOne({
        _id: objectId,
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
      console.error("DELETE /api/users/:id error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete user.",
      });
    }
  },
);

// ============================================================
// EXPORT ROUTER
// ============================================================

export default router;
