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
 */
router.post("/register", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();
    const firebaseUser = req.user;

    if (!firebaseUser?.uid) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const { name, phone, photo, provider, profile } = req.body || {};

    // ----------------------------------------------------------
    // Validate name
    // ----------------------------------------------------------

    const cleanName = typeof name === "string" ? name.trim() : "";

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    if (cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must be 100 characters or less.",
      });
    }

    // ----------------------------------------------------------
    // Clean optional fields
    // ----------------------------------------------------------

    const cleanPhone = typeof phone === "string" ? phone.trim() : "";

    const cleanPhoto = typeof photo === "string" ? photo.trim() : "";

    const cleanProvider =
      typeof provider === "string" && provider.trim()
        ? provider.trim()
        : "password";

    const cleanProfile =
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? profile
        : {};

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
    // Create MongoDB user
    // ----------------------------------------------------------

    const now = new Date();

    const newUser = {
      uid: firebaseUser.uid,

      email:
        typeof firebaseUser.email === "string"
          ? firebaseUser.email.toLowerCase().trim()
          : null,

      name: cleanName,

      phone: cleanPhone || null,

      photo: cleanPhoto || firebaseUser.picture || null,

      provider: cleanProvider,

      // Server controlled.
      role: "student",

      // Server controlled.
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

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      user: createdUser,
    });
  } catch (error) {
    console.error("POST /api/auth/register error:", error);

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
 * Update authenticated user's profile.
 *
 * Editable:
 * - name
 * - phone
 * - photo
 * - profile
 *
 * Protected:
 * - uid
 * - email
 * - role
 * - status
 * - createdAt
 * - emailVerified
 */
router.patch("/me", verifyToken, verifyUser, async (req, res) => {
  try {
    const { users } = getCollections();
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const { name, phone, photo, profile } = req.body || {};

    const updateData = {
      updatedAt: new Date(),
    };

    // --------------------------------------------------------
    // Name
    // --------------------------------------------------------

    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).json({
          success: false,
          message: "Name must be a string.",
        });
      }

      const cleanName = name.trim();

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }

      if (cleanName.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Name must be 100 characters or less.",
        });
      }

      updateData.name = cleanName;
    }

    // --------------------------------------------------------
    // Phone
    // --------------------------------------------------------

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a string.",
        });
      }

      updateData.phone = phone.trim() || null;
    }

    // --------------------------------------------------------
    // Photo
    // --------------------------------------------------------

    if (photo !== undefined) {
      if (typeof photo !== "string") {
        return res.status(400).json({
          success: false,
          message: "Photo must be a string.",
        });
      }

      updateData.photo = photo.trim() || null;
    }

    // --------------------------------------------------------
    // Profile
    // --------------------------------------------------------

    if (profile !== undefined) {
      if (
        profile === null ||
        typeof profile !== "object" ||
        Array.isArray(profile)
      ) {
        return res.status(400).json({
          success: false,
          message: "Profile must be a valid object.",
        });
      }

      updateData.profile = profile;
    }

    // --------------------------------------------------------
    // Check update data
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
    console.error("PATCH /api/auth/me error:", error);

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
 * This endpoint does not invalidate Firebase tokens.
 */
router.post("/logout", verifyToken, async (req, res) => {
  try {
    const { users } = getCollections();
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
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
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logout successful.",
    });
  } catch (error) {
    console.error("POST /api/auth/logout error:", error);

    return res.status(500).json({
      success: false,
      message: "Logout failed.",
    });
  }
});

export default router;
