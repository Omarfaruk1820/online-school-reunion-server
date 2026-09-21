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

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 11;
const MAX_PHOTO_URL_LENGTH = 2000;

const MAX_BATCH_LENGTH = 50;
const MAX_CLASS_LENGTH = 50;
const MAX_DEPARTMENT_LENGTH = 50;
const MAX_PROFESSION_LENGTH = 100;
const MAX_ORGANIZATION_LENGTH = 150;
const MAX_ADDRESS_LENGTH = 300;
const MAX_BIO_LENGTH = 1000;

const ALLOWED_ROLES = ["student", "admin"];

const ALLOWED_STATUSES = ["active", "inactive", "blocked"];

const ALLOWED_DEPARTMENTS = [
  "science",
  "commerce",
  "humanities",
  "vocational",
  "none",
];

const ALLOWED_PROFILE_FIELDS = [
  "batch",
  "className",
  "department",
  "profession",
  "organization",
  "address",
  "bio",
];

const PROFILE_FIELD_MAX_LENGTHS = {
  batch: MAX_BATCH_LENGTH,
  className: MAX_CLASS_LENGTH,
  department: MAX_DEPARTMENT_LENGTH,
  profession: MAX_PROFESSION_LENGTH,
  organization: MAX_ORGANIZATION_LENGTH,
  address: MAX_ADDRESS_LENGTH,
  bio: MAX_BIO_LENGTH,
};

const PHONE_REGEX = /^01[3-9]\d{8}$/;

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

function isValidHttpUrl(value) {
  if (!value) {
    return true;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
// FIREBASE PROVIDER
// ============================================================

function getFirebaseProvider(firebaseUser) {
  const providerFromFirebase = cleanString(
    firebaseUser?.firebase?.sign_in_provider,
  );

  if (providerFromFirebase) {
    return providerFromFirebase;
  }

  const fallbackProvider = cleanString(firebaseUser?.provider);

  if (fallbackProvider) {
    return fallbackProvider;
  }

  return "password";
}

// ============================================================
// PROFILE VALIDATION
// ============================================================

function validateProfile(profile) {
  if (profile === undefined) {
    return {
      valid: true,
      profile: undefined,
      error: null,
    };
  }

  if (
    profile === null ||
    typeof profile !== "object" ||
    Array.isArray(profile)
  ) {
    return {
      valid: false,
      profile: undefined,
      error: "Profile must be a valid object.",
    };
  }

  const cleanProfile = {};

  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (profile[field] === undefined) {
      continue;
    }

    if (typeof profile[field] !== "string") {
      return {
        valid: false,
        profile: undefined,
        error: `${field} must be a string.`,
      };
    }

    const value = profile[field].trim();

    const maxLength = PROFILE_FIELD_MAX_LENGTHS[field];

    if (maxLength && value.length > maxLength) {
      return {
        valid: false,
        profile: undefined,
        error: `${field} must be ${maxLength} characters or less.`,
      };
    }

    if (
      field === "department" &&
      value &&
      !ALLOWED_DEPARTMENTS.includes(value)
    ) {
      return {
        valid: false,
        profile: undefined,
        error: "Invalid department selected.",
      };
    }

    cleanProfile[field] = value;
  }

  return {
    valid: true,
    profile: cleanProfile,
    error: null,
  };
}

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
  // MongoDB _id -> public id
  // ----------------------------------------------------------

  if (sanitizedUser._id) {
    sanitizedUser.id = sanitizedUser._id.toString();

    delete sanitizedUser._id;
  }

  // ----------------------------------------------------------
  // Photo
  // ----------------------------------------------------------

  const cleanPhoto = cleanString(sanitizedUser.photo);

  if (cleanPhoto) {
    sanitizedUser.photo = cleanPhoto;
  } else {
    delete sanitizedUser.photo;
  }

  // ----------------------------------------------------------
  // Phone
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
// GET USER BY UID
// ============================================================

async function getUserByUid(users, uid) {
  return users.findOne(
    { uid },
    {
      projection: USER_PROJECTION,
    },
  );
}

// ============================================================
// POST /api/users
// ============================================================
//
// Create or synchronize the authenticated Firebase user.
//
// Firebase ID token is the source of truth for:
// - uid
// - email
// - emailVerified
// - provider
//
// Client can provide:
// - name
// - phone
// - photo
// - profile
//
// Protected by Firebase ID token.
// ============================================================

router.post("/", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      return res.status(500).json({
        success: false,
        code: "database/users-not-ready",
        message: "Database is not ready.",
      });
    }

    const firebaseUser = req.user;

    // ========================================================
    // FIREBASE IDENTITY
    // ========================================================

    const uid = cleanString(firebaseUser?.uid);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated Firebase user not found.",
      });
    }

    const firebaseEmail = normalizeEmail(firebaseUser?.email);

    if (!firebaseEmail) {
      return res.status(400).json({
        success: false,
        code: "auth/email-missing",
        message: "A valid Firebase email is required.",
      });
    }

    // ========================================================
    // CLIENT DATA
    // ========================================================

    const body = req.body || {};

    const cleanName = cleanString(body.name);
    const cleanPhone = cleanString(body.phone);
    const cleanPhoto = cleanString(body.photo);

    // ========================================================
    // PROVIDER
    // ========================================================

    const provider = getFirebaseProvider(firebaseUser);

    const isGoogleProvider = provider === "google.com" || provider === "google";

    // ========================================================
    // DEVELOPMENT DEBUG
    // ========================================================

    if (process.env.NODE_ENV !== "production") {
      console.log("POST /api/users payload:", {
        uid,
        email: firebaseEmail,
        provider,
        name: cleanName,
        phone: cleanPhone ? "***********" : "",
        hasPhoto: Boolean(cleanPhoto),
        hasProfile: Boolean(body.profile),
      });
    }

    // ========================================================
    // NAME VALIDATION
    // ========================================================

    if (cleanName.length > MAX_NAME_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "validation/name-too-long",
        message: "Name cannot exceed 100 characters.",
      });
    }

    // ========================================================
    // PHONE VALIDATION
    // ========================================================

    if (cleanPhone && cleanPhone.length !== MAX_PHONE_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-length",
        message: "Phone number must contain 11 digits.",
      });
    }

    if (cleanPhone && !isValidBangladeshiPhone(cleanPhone)) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-invalid",
        message: "Enter a valid Bangladeshi phone number.",
      });
    }

    // ========================================================
    // PHOTO VALIDATION
    // ========================================================

    if (cleanPhoto.length > MAX_PHOTO_URL_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "validation/photo-too-long",
        message: "Photo URL is too long.",
      });
    }

    if (cleanPhoto && !isValidHttpUrl(cleanPhoto)) {
      return res.status(400).json({
        success: false,
        code: "validation/photo-invalid",
        message: "Please provide a valid photo URL.",
      });
    }

    // ========================================================
    // PROFILE VALIDATION
    // ========================================================

    const profileValidation = validateProfile(body.profile);

    if (!profileValidation.valid) {
      return res.status(400).json({
        success: false,
        code: "validation/profile-invalid",
        message: profileValidation.error,
      });
    }

    // ========================================================
    // FIND EXISTING USER BY UID
    // ========================================================

    const existingUser = await users.findOne({ uid });

    // ========================================================
    // EMAIL CONFLICT CHECK
    // ========================================================

    if (existingUser) {
      const existingEmail = normalizeEmail(existingUser.email);

      if (existingEmail && existingEmail !== firebaseEmail) {
        const emailOwner = await users.findOne({
          email: firebaseEmail,
          uid: {
            $ne: uid,
          },
        });

        if (emailOwner) {
          return res.status(409).json({
            success: false,
            code: "user/email-already-in-use",
            message: "This email is already associated with another user.",
          });
        }
      }
    } else {
      const emailOwner = await users.findOne({
        email: firebaseEmail,
      });

      if (emailOwner) {
        return res.status(409).json({
          success: false,
          code: "user/email-already-in-use",
          message: "This email is already associated with another user.",
        });
      }
    }

    // ========================================================
    // UPDATE EXISTING USER
    // ========================================================

    if (existingUser) {
      const now = new Date();

      const updateOperation = {
        $set: {
          email: firebaseEmail,

          provider,

          emailVerified: firebaseUser?.emailVerified === true,

          lastLogin: now,

          updatedAt: now,
        },
      };

      // ------------------------------------------------------
      // NAME
      // ------------------------------------------------------

      if (cleanName) {
        updateOperation.$set.name = cleanName;
      } else if (
        !cleanString(existingUser.name) &&
        cleanString(firebaseUser?.name)
      ) {
        updateOperation.$set.name = cleanString(firebaseUser.name);
      }

      // ------------------------------------------------------
      // PHONE
      // ------------------------------------------------------

      if (cleanPhone) {
        updateOperation.$set.phone = cleanPhone;
      }

      // ------------------------------------------------------
      // PHOTO
      // ------------------------------------------------------

      if (cleanPhoto) {
        updateOperation.$set.photo = cleanPhoto;
      } else {
        const existingPhoto = cleanString(existingUser.photo);

        const firebasePicture = cleanString(firebaseUser?.picture);

        if (existingPhoto) {
          updateOperation.$set.photo = existingPhoto;
        } else if (
          firebasePicture &&
          firebasePicture.length <= MAX_PHOTO_URL_LENGTH &&
          isValidHttpUrl(firebasePicture)
        ) {
          updateOperation.$set.photo = firebasePicture;
        }
      }

      // ------------------------------------------------------
      // PROFILE
      // ------------------------------------------------------

      if (
        profileValidation.profile &&
        Object.keys(profileValidation.profile).length > 0
      ) {
        updateOperation.$set.profile = {
          ...(existingUser.profile || {}),
          ...profileValidation.profile,
        };
      }

      // ------------------------------------------------------
      // UPDATE DATABASE
      // ------------------------------------------------------

      await users.updateOne(
        {
          uid,
        },
        updateOperation,
      );

      // ------------------------------------------------------
      // GET UPDATED USER
      // ------------------------------------------------------

      const updatedUser = await getUserByUid(users, uid);

      return res.status(200).json({
        success: true,
        code: "user/synchronized",
        message: "User synchronized successfully.",
        user: sanitizeUser(updatedUser),
      });
    }

    // ========================================================
    // CREATE NEW USER
    // ========================================================

    // Password users require name and phone.
    //
    // Google users may initially have no phone.
    // They can complete their phone later.
    // ========================================================

    if (!isGoogleProvider && !cleanName) {
      return res.status(400).json({
        success: false,
        code: "validation/name-required",
        message: "Name is required.",
      });
    }

    if (!isGoogleProvider && !cleanPhone) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-required",
        message: "Phone number is required.",
      });
    }

    const now = new Date();

    const newUser = {
      uid,

      email: firebaseEmail,

      name: cleanName || cleanString(firebaseUser?.name) || "School Member",

      phone: cleanPhone || null,

      provider,

      // Server controlled
      role: "student",

      status: "active",

      emailVerified: firebaseUser?.emailVerified === true,

      profile: profileValidation.profile || {},

      createdAt: now,

      updatedAt: now,

      lastLogin: now,
    };

    // ========================================================
    // FIREBASE PHOTO
    // ========================================================

    const firebasePicture = cleanString(firebaseUser?.picture);

    if (cleanPhoto) {
      newUser.photo = cleanPhoto;
    } else if (
      firebasePicture &&
      firebasePicture.length <= MAX_PHOTO_URL_LENGTH &&
      isValidHttpUrl(firebasePicture)
    ) {
      newUser.photo = firebasePicture;
    }

    // ========================================================
    // INSERT
    // ========================================================

    const result = await users.insertOne(newUser);

    if (!result.insertedId) {
      return res.status(500).json({
        success: false,
        code: "user/create-failed",
        message: "Failed to create user.",
      });
    }

    // ========================================================
    // GET CREATED USER
    // ========================================================

    const createdUser = await users.findOne(
      {
        _id: result.insertedId,
      },
      {
        projection: USER_PROJECTION,
      },
    );

    if (!createdUser) {
      return res.status(500).json({
        success: false,
        code: "user/retrieve-failed",
        message: "User was created but could not be retrieved.",
      });
    }

    return res.status(201).json({
      success: true,
      code: "user/created",
      message: "User created successfully.",
      user: sanitizeUser(createdUser),
    });
  } catch (error) {
    console.error("POST /api/users error:", error);

    // ========================================================
    // DUPLICATE KEY
    // ========================================================

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "user/already-exists",
        message: "User already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      code: "user/synchronization-failed",
      message: "Failed to synchronize user.",
    });
  }
});

// ============================================================
// GET /api/users
// ============================================================
//
// Admin only.
//
// Query parameters:
//
// ?page=1
// ?limit=10
// ?search=omar
// ?sort=newest
// ?sort=oldest
// ?sort=name-asc
// ?sort=name-desc
// ?sort=last-login
// ============================================================

router.get("/", verifyToken, verifyUser, verifyAdmin, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      return res.status(500).json({
        success: false,
        code: "database/users-not-ready",
        message: "Database is not ready.",
      });
    }

    const { page, limit, skip } = parsePagination(
      req.query.page,
      req.query.limit,
    );

    // ------------------------------------------------------
    // SEARCH
    // ------------------------------------------------------

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

    // ------------------------------------------------------
    // SORTING
    // ------------------------------------------------------

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

    // ------------------------------------------------------
    // COUNT + DATA
    // ------------------------------------------------------

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
      code: "users/fetch-failed",
      message: "Failed to get users.",
    });
  }
});

// ============================================================
// GET /api/users/:email
// ============================================================
//
// Admin can access any user.
//
// Normal user can access only their own email.
// ============================================================

router.get("/:email", verifyToken, verifyUser, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      return res.status(500).json({
        success: false,
        code: "database/users-not-ready",
        message: "Database is not ready.",
      });
    }

    const requestedEmail = normalizeEmail(req.params.email);

    if (!requestedEmail) {
      return res.status(400).json({
        success: false,
        code: "validation/email-invalid",
        message: "Valid email is required.",
      });
    }

    const currentUser = req.userData;

    const isAdmin = currentUser?.role === "admin";

    // ------------------------------------------------------
    // ACCESS CONTROL
    // ------------------------------------------------------

    if (!isAdmin && normalizeEmail(currentUser?.email) !== requestedEmail) {
      return res.status(403).json({
        success: false,
        code: "user/access-denied",
        message: "You are not allowed to access this user.",
      });
    }

    // ------------------------------------------------------
    // FIND USER
    // ------------------------------------------------------

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
        code: "user/not-found",
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
      code: "user/fetch-failed",
      message: "Failed to get user.",
    });
  }
});

// ============================================================
// PATCH /api/users/:id/role
// ============================================================
//
// Admin only.
// Admin cannot change their own role.
// ============================================================

router.patch(
  "/:id/role",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      if (!users) {
        return res.status(500).json({
          success: false,
          code: "database/users-not-ready",
          message: "Database is not ready.",
        });
      }

      const { id } = req.params;

      // ------------------------------------------------------
      // OBJECT ID
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          code: "validation/id-invalid",
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // ROLE
      // ------------------------------------------------------

      const role = cleanString(req.body?.role);

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          code: "validation/role-invalid",
          message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
        });
      }

      // ------------------------------------------------------
      // TARGET USER
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          code: "user/not-found",
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // PREVENT SELF ROLE CHANGE
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          code: "admin/self-role-change",
          message: "You cannot change your own role.",
        });
      }

      // ------------------------------------------------------
      // SAME ROLE
      // ------------------------------------------------------

      if (targetUser.role === role) {
        return res.status(200).json({
          success: true,
          code: "user/role-unchanged",
          message: "User already has this role.",
          user: sanitizeUser(targetUser),
        });
      }

      // ------------------------------------------------------
      // UPDATE
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
      // RETRIEVE UPDATED USER
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
        code: "user/role-updated",
        message: "User role updated successfully.",
        user: sanitizeUser(updatedUser),
      });
    } catch (error) {
      console.error("PATCH /api/users/:id/role error:", error);

      return res.status(500).json({
        success: false,
        code: "user/role-update-failed",
        message: "Failed to update user role.",
      });
    }
  },
);

// ============================================================
// PATCH /api/users/:id/status
// ============================================================
//
// Admin only.
// Admin cannot change their own status.
// ============================================================

router.patch(
  "/:id/status",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      if (!users) {
        return res.status(500).json({
          success: false,
          code: "database/users-not-ready",
          message: "Database is not ready.",
        });
      }

      const { id } = req.params;

      // ------------------------------------------------------
      // OBJECT ID
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          code: "validation/id-invalid",
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // STATUS
      // ------------------------------------------------------

      const status = cleanString(req.body?.status);

      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          code: "validation/status-invalid",
          message: `Invalid status. Allowed statuses: ${ALLOWED_STATUSES.join(
            ", ",
          )}.`,
        });
      }

      // ------------------------------------------------------
      // TARGET USER
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          code: "user/not-found",
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // PREVENT SELF STATUS CHANGE
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          code: "admin/self-status-change",
          message: "You cannot change your own account status.",
        });
      }

      // ------------------------------------------------------
      // SAME STATUS
      // ------------------------------------------------------

      if (targetUser.status === status) {
        return res.status(200).json({
          success: true,
          code: "user/status-unchanged",
          message: "User already has this account status.",
          user: sanitizeUser(targetUser),
        });
      }

      // ------------------------------------------------------
      // UPDATE
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
      // RETRIEVE UPDATED USER
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
        code: "user/status-updated",
        message: "User status updated successfully.",
        user: sanitizeUser(updatedUser),
      });
    } catch (error) {
      console.error("PATCH /api/users/:id/status error:", error);

      return res.status(500).json({
        success: false,
        code: "user/status-update-failed",
        message: "Failed to update user status.",
      });
    }
  },
);

// ============================================================
// DELETE /api/users/:id
// ============================================================
//
// Admin only.
//
// This deletes the MongoDB user document.
// It does NOT delete the Firebase Authentication account.
// ============================================================

router.delete(
  "/:id",
  verifyToken,
  verifyUser,
  verifyAdmin,
  async (req, res) => {
    try {
      const { users } = getCollections();

      if (!users) {
        return res.status(500).json({
          success: false,
          code: "database/users-not-ready",
          message: "Database is not ready.",
        });
      }

      const { id } = req.params;

      // ------------------------------------------------------
      // OBJECT ID
      // ------------------------------------------------------

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          code: "validation/id-invalid",
          message: "Invalid user ID.",
        });
      }

      const objectId = new ObjectId(id);

      // ------------------------------------------------------
      // TARGET USER
      // ------------------------------------------------------

      const targetUser = await users.findOne({
        _id: objectId,
      });

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          code: "user/not-found",
          message: "User not found.",
        });
      }

      // ------------------------------------------------------
      // PREVENT SELF DELETION
      // ------------------------------------------------------

      if (targetUser.uid === req.user.uid) {
        return res.status(403).json({
          success: false,
          code: "admin/self-delete",
          message: "You cannot delete your own account.",
        });
      }

      // ------------------------------------------------------
      // DELETE MONGODB USER
      // ------------------------------------------------------

      const result = await users.deleteOne({
        _id: objectId,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          code: "user/delete-failed",
          message: "User could not be deleted.",
        });
      }

      return res.status(200).json({
        success: true,
        code: "user/deleted",
        message: "User deleted successfully.",
      });
    } catch (error) {
      console.error("DELETE /api/users/:id error:", error);

      return res.status(500).json({
        success: false,
        code: "user/delete-failed",
        message: "Failed to delete user.",
      });
    }
  },
);

// ============================================================
// EXPORT
// ============================================================

export default router;
