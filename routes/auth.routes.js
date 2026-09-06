import express from "express";

import verifyToken from "../middleware/verifyToken.js";
import verifyUser from "../middleware/verifyUser.js";

import { getCollections } from "../config/db.js";

const router = express.Router();

// ============================================================
// POST /api/auth/register
// Create authenticated user in MongoDB usersCollection
// ============================================================

router.post("/register", verifyToken, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const firebaseUser = req.user;

    const { name, phone, photo, provider, profile } = req.body || {};

    // --------------------------------------------------------
    // Basic validation
    // --------------------------------------------------------

    if (!firebaseUser?.uid) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const cleanName = typeof name === "string" ? name.trim() : "";

    const cleanPhone = typeof phone === "string" ? phone.trim() : "";

    const cleanPhoto = typeof photo === "string" ? photo.trim() : "";

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    // --------------------------------------------------------
    // Check existing user
    // --------------------------------------------------------

    const existingUser = await usersCollection.findOne({
      uid: firebaseUser.uid,
    });

    if (existingUser) {
      return res.status(200).json({
        success: true,
        message: "User already exists.",
        user: existingUser,
      });
    }

    // --------------------------------------------------------
    // Create new MongoDB user
    // --------------------------------------------------------

    const now = new Date();

    const newUser = {
      uid: firebaseUser.uid,

      email: firebaseUser.email?.toLowerCase().trim() || null,

      name: cleanName,

      phone: cleanPhone || null,

      photo: cleanPhoto || firebaseUser.picture || null,

      provider: provider || firebaseUser.provider || "password",

      role: "student",

      status: "active",

      profile:
        profile && typeof profile === "object" && !Array.isArray(profile)
          ? profile
          : {},

      emailVerified: firebaseUser.emailVerified === true,

      createdAt: now,

      updatedAt: now,

      lastLogin: now,
    };

    const result = await usersCollection.insertOne(newUser);

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
    console.error("POST /auth/register error:", error);

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

// ============================================================
// GET /api/auth/me
// Get current authenticated MongoDB user
// ============================================================

router.get("/me", verifyToken, verifyUser, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.userData,
  });
});

// ============================================================
// PATCH /api/auth/me
// Update current user's profile
// ============================================================

router.patch("/me", verifyToken, verifyUser, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const uid = req.user.uid;

    const { name, phone, photo, profile } = req.body || {};

    const updateData = {
      updatedAt: new Date(),
    };

    // ------------------------------------------------------
    // Name
    // ------------------------------------------------------

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

    // ------------------------------------------------------
    // Phone
    // ------------------------------------------------------

    if (typeof phone === "string") {
      updateData.phone = phone.trim();
    }

    // ------------------------------------------------------
    // Photo
    // ------------------------------------------------------

    if (typeof photo === "string") {
      updateData.photo = photo.trim();
    }

    // ------------------------------------------------------
    // Profile
    // ------------------------------------------------------

    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      updateData.profile = profile;
    }

    // ------------------------------------------------------
    // Update MongoDB
    // ------------------------------------------------------

    const result = await usersCollection.updateOne(
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

    const updatedUser = await usersCollection.findOne({
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

// ============================================================
// POST /api/auth/logout
// Logout endpoint
// ============================================================

router.post("/logout", verifyToken, async (req, res) => {
  try {
    const { usersCollection } = getCollections();

    const uid = req.user.uid;

    await usersCollection.updateOne(
      { uid },
      {
        $set: {
          updatedAt: new Date(),
        },
      },
    );

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
