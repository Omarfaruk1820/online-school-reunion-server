// api/routes/auth.routes.js

import express from "express";

import verifyToken from "../middleware/verifyToken.js";
import verifyUser from "../middleware/verifyUser.js";

import { getCollections } from "../config/db.js";

const router = express.Router();

// ============================================================
// CONSTANTS
// ============================================================

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

const PHONE_REGEX = /^01[3-9]\d{8}$/;

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

// ============================================================
// USER PROJECTION
// ============================================================
//
// Only return fields that the frontend is allowed to receive.
//
// Never expose:
// - internal/private MongoDB fields
// - password-like fields
// - authentication secrets
// - sensitive server-only metadata
//
// Firebase identity remains controlled by Firebase.
// Role/status remain controlled by the server.
//

const USER_PROJECTION = {
  _id: 1,
  uid: 1,
  name: 1,
  email: 1,
  phone: 1,
  photo: 1,
  provider: 1,
  role: 1,
  status: 1,
  emailVerified: 1,
  profile: 1,
  createdAt: 1,
  updatedAt: 1,
  lastLogin: 1,
};

// ============================================================
// HELPERS
// ============================================================

const normalizeString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const normalizeEmail = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  return email || null;
};

const isValidBangladeshiPhone = (phone) => {
  return PHONE_REGEX.test(phone);
};

const isValidHttpUrl = (value) => {
  if (!value) {
    return true;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const createDefaultProfile = () => {
  return {
    batch: "",
    className: "",
    department: "",
    profession: "",
    organization: "",
    address: "",
    bio: "",
  };
};

const getSafeUser = async (users, uid) => {
  return users.findOne(
    { uid },
    {
      projection: USER_PROJECTION,
    },
  );
};

const getDatabaseErrorResponse = (res) => {
  return res.status(500).json({
    success: false,
    code: "database/users-not-ready",
    message: "Database is not ready.",
  });
};

const validateProfileField = (field, value) => {
  if (typeof value !== "string") {
    return `${field} must be a string.`;
  }

  const cleanValue = value.trim();

  const maxLength = PROFILE_FIELD_MAX_LENGTHS[field];

  if (maxLength && cleanValue.length > maxLength) {
    return `${field} must be ${maxLength} characters or less.`;
  }

  if (
    field === "department" &&
    cleanValue &&
    !ALLOWED_DEPARTMENTS.includes(cleanValue)
  ) {
    return "Invalid department selected.";
  }

  return null;
};

const buildProfileUpdate = (profile) => {
  const updateData = {};

  // Profile not included in request.
  if (profile === undefined) {
    return {
      updateData,
      error: null,
    };
  }

  // Profile must be a plain object.
  if (
    profile === null ||
    typeof profile !== "object" ||
    Array.isArray(profile)
  ) {
    return {
      updateData: {},
      error: "Profile must be a valid object.",
    };
  }

  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (profile[field] === undefined) {
      continue;
    }

    const validationError = validateProfileField(field, profile[field]);

    if (validationError) {
      return {
        updateData: {},
        error: validationError,
      };
    }

    const cleanValue = profile[field].trim();

    updateData[`profile.${field}`] = cleanValue;
  }

  return {
    updateData,
    error: null,
  };
};

const getFirebaseProvider = (firebaseUser) => {
  if (
    typeof firebaseUser?.provider === "string" &&
    firebaseUser.provider.trim()
  ) {
    return firebaseUser.provider.trim();
  }

  return "password";
};

const getFirebasePhoto = (firebaseUser) => {
  if (typeof firebaseUser?.picture !== "string") {
    return null;
  }

  const photo = firebaseUser.picture.trim();

  if (!photo) {
    return null;
  }

  if (photo.length > MAX_PHOTO_URL_LENGTH) {
    return null;
  }

  if (!isValidHttpUrl(photo)) {
    return null;
  }

  return photo;
};

// ============================================================
// POST /api/auth/register
// ============================================================
//
// Firebase Authentication must already be completed on the
// frontend.
//
// Authorization:
// Bearer <firebase-id-token>
//
// Body:
// {
//   "name": "...",
//   "phone": "..."
// }
//
// Firebase controls:
// - uid
// - email
// - emailVerified
// - provider
//
// Server controls:
// - role
// - status
// - timestamps
// - MongoDB user identity
//
// User cannot submit:
// - uid
// - email
// - role
// - status
// - provider
// - emailVerified
// ============================================================

router.post("/register", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      console.error(
        "POST /api/auth/register - Users collection is not initialized.",
      );

      return getDatabaseErrorResponse(res);
    }

    const firebaseUser = req.user;

    // --------------------------------------------------------
    // Firebase identity
    // --------------------------------------------------------

    if (!firebaseUser?.uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Invalid authentication token.",
      });
    }

    const uid = firebaseUser.uid;

    const email = normalizeEmail(firebaseUser.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        code: "auth/email-missing",
        message: "A valid Firebase email is required.",
      });
    }

    // --------------------------------------------------------
    // Request data
    // --------------------------------------------------------

    const name = normalizeString(req.body?.name);
    const phone = normalizeString(req.body?.phone);

    // --------------------------------------------------------
    // Name validation
    // --------------------------------------------------------

    if (!name) {
      return res.status(400).json({
        success: false,
        code: "validation/name-required",
        message: "Name is required.",
      });
    }

    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "validation/name-too-long",
        message: "Name must be 100 characters or less.",
      });
    }

    // --------------------------------------------------------
    // Phone validation
    // --------------------------------------------------------

    if (!phone) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-required",
        message: "Phone number is required.",
      });
    }

    if (phone.length !== MAX_PHONE_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-length",
        message: "Phone number must contain 11 digits.",
      });
    }

    if (!isValidBangladeshiPhone(phone)) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-invalid",
        message: "Enter a valid Bangladeshi phone number.",
      });
    }

    // --------------------------------------------------------
    // Check existing Firebase UID
    // --------------------------------------------------------

    const existingUser = await users.findOne({ uid });

    if (existingUser) {
      const existingEmail = normalizeEmail(existingUser.email);

      // ------------------------------------------------------
      // Firebase email must remain the source of truth.
      //
      // Do not silently change MongoDB email here.
      // ------------------------------------------------------

      if (existingEmail && existingEmail !== email) {
        console.error(
          "POST /api/auth/register - Firebase/MongoDB email mismatch.",
          {
            uid,
            firebaseEmail: email,
            databaseEmail: existingEmail,
          },
        );

        return res.status(409).json({
          success: false,
          code: "auth/email-mismatch",
          message:
            "The authenticated account does not match the existing user account.",
        });
      }

      const now = new Date();

      // ------------------------------------------------------
      // Existing users:
      //
      // Update only authentication/login-related fields.
      //
      // Never overwrite:
      // - name
      // - phone
      // - photo
      // - profile
      // - role
      // - status
      // ------------------------------------------------------

      await users.updateOne(
        { uid },
        {
          $set: {
            emailVerified: firebaseUser.emailVerified === true,
            lastLogin: now,
            updatedAt: now,
          },
        },
      );

      const currentUser = await getSafeUser(users, uid);

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          code: "user/not-found",
          message: "User account could not be found.",
        });
      }

      return res.status(200).json({
        success: true,
        code: "user/already-exists",
        message: "User already exists.",
        user: currentUser,
      });
    }

    // --------------------------------------------------------
    // Firebase profile photo
    // --------------------------------------------------------

    const firebasePhoto = getFirebasePhoto(firebaseUser);

    // --------------------------------------------------------
    // Provider
    // --------------------------------------------------------

    const provider = getFirebaseProvider(firebaseUser);

    // --------------------------------------------------------
    // Create user
    // --------------------------------------------------------

    const now = new Date();

    const newUser = {
      uid,
      email,
      name,
      phone,

      photo: firebasePhoto,

      provider,

      // ------------------------------------------------------
      // Server-controlled fields
      // ------------------------------------------------------

      role: "student",
      status: "active",

      emailVerified: firebaseUser.emailVerified === true,

      // ------------------------------------------------------
      // Default profile
      // ------------------------------------------------------

      profile: createDefaultProfile(),

      // ------------------------------------------------------
      // Timestamps
      // ------------------------------------------------------

      createdAt: now,
      updatedAt: now,
      lastLogin: now,
    };

    const result = await users.insertOne(newUser);

    if (!result.insertedId) {
      return res.status(500).json({
        success: false,
        code: "user/create-failed",
        message: "Failed to create user account.",
      });
    }

    // --------------------------------------------------------
    // Retrieve created user
    // --------------------------------------------------------

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
      message: "User registered successfully.",
      user: createdUser,
    });
  } catch (error) {
    console.error("POST /api/auth/register error:", error);

    // --------------------------------------------------------
    // MongoDB duplicate key
    // --------------------------------------------------------

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "user/already-exists",
        message: "User already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      code: "user/registration-failed",
      message: "Failed to register user.",
    });
  }
});

// ============================================================
// GET /api/auth/me
// ============================================================
//
// Returns the currently authenticated MongoDB user.
//
// Middleware:
//
// verifyToken
//      ↓
// verifyUser
//      ↓
// route
// ============================================================

router.get("/me", verifyToken, verifyUser, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.userData,
  });
});

// ============================================================
// PATCH /api/auth/me
// ============================================================
//
// Allowed:
// - name
// - phone
// - photo
// - profile
//
// Profile fields:
// - batch
// - className
// - department
// - profession
// - organization
// - address
// - bio
//
// Never allowed:
// - uid
// - email
// - role
// - status
// - provider
// - emailVerified
// - createdAt
// - lastLogin
// ============================================================

router.patch("/me", verifyToken, verifyUser, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      console.error(
        "PATCH /api/auth/me - Users collection is not initialized.",
      );

      return getDatabaseErrorResponse(res);
    }

    const uid = req.user?.uid;

    // ------------------------------------------------------
    // Authentication
    // ------------------------------------------------------

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Invalid authentication token.",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};

    const { name, phone, photo, profile } = body;

    // ------------------------------------------------------
    // Base update
    // ------------------------------------------------------

    const updateData = {
      updatedAt: new Date(),
    };

    // ======================================================
    // NAME
    // ======================================================

    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).json({
          success: false,
          code: "validation/name-type",
          message: "Name must be a string.",
        });
      }

      const cleanName = name.trim();

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          code: "validation/name-empty",
          message: "Name cannot be empty.",
        });
      }

      if (cleanName.length > MAX_NAME_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/name-too-long",
          message: "Name must be 100 characters or less.",
        });
      }

      updateData.name = cleanName;
    }

    // ======================================================
    // PHONE
    // ======================================================

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          code: "validation/phone-type",
          message: "Phone must be a string.",
        });
      }

      const cleanPhone = phone.trim();

      if (!cleanPhone) {
        return res.status(400).json({
          success: false,
          code: "validation/phone-empty",
          message: "Phone number cannot be empty.",
        });
      }

      if (cleanPhone.length !== MAX_PHONE_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/phone-length",
          message: "Phone number must contain 11 digits.",
        });
      }

      if (!isValidBangladeshiPhone(cleanPhone)) {
        return res.status(400).json({
          success: false,
          code: "validation/phone-invalid",
          message: "Enter a valid Bangladeshi phone number.",
        });
      }

      updateData.phone = cleanPhone;
    }

    // ======================================================
    // PHOTO
    // ======================================================

    if (photo !== undefined) {
      if (typeof photo !== "string") {
        return res.status(400).json({
          success: false,
          code: "validation/photo-type",
          message: "Photo must be a string.",
        });
      }

      const cleanPhoto = photo.trim();

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

      // Empty string removes the photo.
      updateData.photo = cleanPhoto || null;
    }

    // ======================================================
    // PROFILE
    // ======================================================

    const { updateData: profileUpdate, error: profileError } =
      buildProfileUpdate(profile);

    if (profileError) {
      return res.status(400).json({
        success: false,
        code: "validation/profile-invalid",
        message: profileError,
      });
    }

    Object.assign(updateData, profileUpdate);

    // ======================================================
    // CHECK ACTUAL CHANGES
    // ======================================================

    // updatedAt is always present.
    // If nothing else was supplied, there is nothing to update.

    if (Object.keys(updateData).length === 1) {
      return res.status(400).json({
        success: false,
        code: "validation/no-data",
        message: "No valid profile data provided.",
      });
    }

    // ======================================================
    // UPDATE MONGODB
    // ======================================================

    const result = await users.updateOne(
      { uid },
      {
        $set: updateData,
      },
    );

    // ------------------------------------------------------
    // User not found
    // ------------------------------------------------------

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        code: "user/not-found",
        message: "User account not found.",
      });
    }

    // ======================================================
    // GET UPDATED USER
    // ======================================================

    const updatedUser = await getSafeUser(users, uid);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        code: "user/not-found",
        message: "Updated user could not be found.",
      });
    }

    // ======================================================
    // RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,
      code: "user/profile-updated",
      message: "Profile updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("PATCH /api/auth/me error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "user/duplicate-data",
        message: "The provided information already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      code: "user/profile-update-failed",
      message: "Failed to update profile.",
    });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
//
// Firebase logout itself must happen on the frontend:
//
// signOut(auth)
//
// This endpoint only records the logout activity.
// It does NOT invalidate the Firebase ID token.
// ============================================================

router.post("/logout", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    if (!users) {
      console.error(
        "POST /api/auth/logout - Users collection is not initialized.",
      );

      return getDatabaseErrorResponse(res);
    }

    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Invalid authentication token.",
      });
    }

    const result = await users.updateOne(
      { uid },
      {
        $set: {
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        code: "user/not-found",
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      code: "auth/logout-success",
      message: "Logout successful.",
    });
  } catch (error) {
    console.error("POST /api/auth/logout error:", error);

    return res.status(500).json({
      success: false,
      code: "auth/logout-failed",
      message: "Logout failed.",
    });
  }
});

// ============================================================
// EXPORT ROUTER
// ============================================================

export default router;
