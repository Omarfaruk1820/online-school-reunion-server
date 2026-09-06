import express from "express";

import verifyToken from "../middleware/verifyToken.js";
import verifyUser from "../middleware/verifyUser.js";

import { getCollections } from "../config/db.js";

const router = express.Router();

/**
 * ============================================================
 * POST /api/auth/register
 * ============================================================
 * Create authenticated Firebase user in MongoDB "users" collection.
 *
 * Important:
 * - Firebase handles authentication.
 * - MongoDB stores application user information.
 * - role/status are controlled by the server.
 * - Client cannot choose admin role during registration.
 */
router.post("/register", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    const firebaseUser = req.user;

    const { name, phone, photo, provider, profile } = req.body || {};

    // ----------------------------------------------------------
    // Authentication validation
    // ----------------------------------------------------------

    if (!firebaseUser?.uid) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    // ----------------------------------------------------------
    // Clean incoming data
    // ----------------------------------------------------------

    const cleanName = typeof name === "string" ? name.trim() : "";

    const cleanPhone = typeof phone === "string" ? phone.trim() : "";

    const cleanPhoto = typeof photo === "string" ? photo.trim() : "";

    // ----------------------------------------------------------
    // Name validation
    // ----------------------------------------------------------

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    // ----------------------------------------------------------
    // Check existing user
    // ----------------------------------------------------------

    const existingUser = await users.findOne({
      uid: firebaseUser.uid,
    });

    if (existingUser) {
      return res.status(200).json({
        success: true,
        message: "User already exists.",
        user: existingUser,
      });
    }

    // ----------------------------------------------------------
    // Determine provider
    // ----------------------------------------------------------

    const cleanProvider =
      typeof provider === "string" && provider.trim()
        ? provider.trim()
        : firebaseUser.provider || "password";

    // ----------------------------------------------------------
    // Prepare profile
    // ----------------------------------------------------------

    const cleanProfile =
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? profile
        : {};

    // ----------------------------------------------------------
    // Create MongoDB user
    // ----------------------------------------------------------

    const now = new Date();

    const newUser = {
      uid: firebaseUser.uid,

      email: firebaseUser.email?.toLowerCase().trim() || null,

      name: cleanName,

      phone: cleanPhone || null,

      photo: cleanPhoto || firebaseUser.picture || null,

      provider: cleanProvider,

      // IMPORTANT:
      // Never trust role from frontend.
      role: "student",

      // IMPORTANT:
      // New users are active by default.
      status: "active",

      profile: cleanProfile,

      emailVerified: firebaseUser.emailVerified === true,

      createdAt: now,

      updatedAt: now,

      lastLogin: now,
    };

    // ----------------------------------------------------------
    // Insert user
    // ----------------------------------------------------------

    const result = await users.insertOne(newUser);

    const createdUser = {
      _id: result.insertedId,
      ...newUser,
    };

    // ----------------------------------------------------------
    // Response
    // ----------------------------------------------------------

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      user: createdUser,
    });
  } catch (error) {
    console.error("POST /auth/register error:", error);

    // MongoDB duplicate key
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "User already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to register user.",
    });
  }
});

/**
 * ============================================================
 * GET /api/auth/me
 * ============================================================
 * Get currently authenticated MongoDB user.
 *
 * Middleware:
 * verifyToken -> verifies Firebase token
 * verifyUser  -> finds MongoDB user and attaches req.userData
 */
router.get("/me", verifyToken, verifyUser, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.userData,
  });
});

/**
 * ============================================================
 * PATCH /api/auth/me
 * ============================================================
 * Update currently authenticated user's profile.
 *
 * User can update:
 * - name
 * - phone
 * - photo
 * - profile
 *
 * User CANNOT update:
 * - uid
 * - email
 * - role
 * - status
 * - createdAt
 */
router.patch("/me", verifyToken, verifyUser, async (req, res) => {
  try {
    const { users } = getCollections();

    const uid = req.user.uid;

    const { name, phone, photo, profile } = req.body || {};

    const updateData = {
      updatedAt: new Date(),
    };

    // --------------------------------------------------------
    // Name
    // --------------------------------------------------------

    if (typeof name === "string") {
      const cleanName = name.trim();

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }

      updateData.name = cleanName;
    }

    // --------------------------------------------------------
    // Phone
    // --------------------------------------------------------

    if (typeof phone === "string") {
      updateData.phone = phone.trim();
    }

    // --------------------------------------------------------
    // Photo
    // --------------------------------------------------------

    if (typeof photo === "string") {
      updateData.photo = photo.trim();
    }

    // --------------------------------------------------------
    // Profile
    // --------------------------------------------------------

    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      updateData.profile = profile;
    }

    // --------------------------------------------------------
    // Check whether there is anything to update
    // --------------------------------------------------------

    if (Object.keys(updateData).length === 1) {
      return res.status(400).json({
        success: false,
        message: "No valid profile data provided.",
      });
    }

    // --------------------------------------------------------
    // Update MongoDB
    // --------------------------------------------------------

    const result = await users.updateOne(
      { uid },
      {
        $set: updateData,
      },
    );

    // --------------------------------------------------------
    // User not found
    // --------------------------------------------------------

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // --------------------------------------------------------
    // Get updated user
    // --------------------------------------------------------

    const updatedUser = await users.findOne({
      uid,
    });

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("PATCH /auth/me error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile.",
    });
  }
});

/**
 * ============================================================
 * POST /api/auth/logout
 * ============================================================
 * Update user's last activity timestamp.
 *
 * Firebase sign-out happens on the client.
 * This endpoint does NOT invalidate Firebase tokens.
 */
router.post("/logout", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();

    const uid = req.user.uid;

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
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logout successful.",
    });
  } catch (error) {
    console.error("POST /auth/logout error:", error);

    return res.status(500).json({
      success: false,
      message: "Logout failed.",
    });
  }
});

export default router;
