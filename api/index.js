import "../config/env.js";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectDB } from "../config/db.js";

import authRoutes from "../routes/auth.routes.js";
import usersRoutes from "../routes/users.routes.js";
import registerRoutes from "../routes/register.routes.js";

const app = express();

// ============================================================
// ENVIRONMENT
// ============================================================

const isProduction = process.env.NODE_ENV === "production";

// ============================================================
// TRUST PROXY
// ============================================================
//
// Required when running behind Vercel / reverse proxy.
// ============================================================

if (isProduction) {
  app.set("trust proxy", 1);
}

// ============================================================
// CORS
// ============================================================

const clientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

console.log("Allowed CORS origins:", clientUrls);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests, health checks,
      // Postman, curl, browser navigation, etc.
      if (!origin) {
        return callback(null, true);
      }

      if (clientUrls.includes(origin)) {
        return callback(null, true);
      }

      console.warn("CORS blocked origin:", origin);

      return callback(null, false);
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],

    optionsSuccessStatus: 204,
  }),
);

// ============================================================
// BODY PARSERS
// ============================================================

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  }),
);

// ============================================================
// COOKIE PARSER
// ============================================================

app.use(cookieParser());

// ============================================================
// ROOT ROUTE
// ============================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "School Reunion Server is running.",
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================
//
// This route intentionally runs before the MongoDB middleware.
// It can confirm that the API itself is alive even if MongoDB
// is temporarily unavailable.
// ============================================================

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Server is healthy.",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
//
// connectDB() should internally cache the MongoDB connection.
// Therefore this middleware does not create a new connection
// for every request when a cached connection already exists.
// ============================================================

app.use(async (req, res, next) => {
  try {
    await connectDB();

    next();
  } catch (error) {
    console.error("Database initialization failed:", error);

    return res.status(500).json({
      success: false,
      code: "database/connection-failed",
      message: "Database connection failed.",
    });
  }
});

// ============================================================
// AUTH ROUTES
// ============================================================

app.use("/api/auth", authRoutes);

// ============================================================
// USER ROUTES
// ============================================================

app.use("/api/users", usersRoutes);

// ============================================================
// REUNION ROUTES
// ============================================================
//
// register.routes.js must contain:
//
// router.get("/", ...)
// router.post("/register", ...)
// router.get("/my-registration", ...)
//
// Final endpoints:
//
// GET  /api/reunion
// POST /api/reunion/register
// GET  /api/reunion/my-registration
// ============================================================

app.use("/api/reunion", registerRoutes);

// ============================================================
// 404 - ROUTE NOT FOUND
// ============================================================

app.use((req, res) => {
  console.warn(`404 Route not found: ${req.method} ${req.originalUrl}`);

  return res.status(404).json({
    success: false,
    code: "route/not-found",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  // ----------------------------------------------------------
  // Invalid JSON
  // ----------------------------------------------------------

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      code: "request/invalid-json",
      message: "Invalid JSON payload.",
    });
  }

  // ----------------------------------------------------------
  // CORS / generic errors
  // ----------------------------------------------------------

  const statusCode = err.statusCode || err.status || 500;

  const message =
    isProduction && statusCode >= 500
      ? "Internal server error."
      : err.message || "Something went wrong.";

  return res.status(statusCode).json({
    success: false,
    code: "server/error",
    message,
  });
});

// ============================================================
// EXPORT
// ============================================================
//
// IMPORTANT:
// Do NOT use app.listen() here when deploying this file to Vercel.
// Vercel handles the server automatically.
// ============================================================

export default app;
