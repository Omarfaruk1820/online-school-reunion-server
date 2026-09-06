import "../config/env.js";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectDB } from "../config/db.js";

import authRoutes from "../routes/auth.routes.js";
import usersRoutes from "../routes/users.routes.js";

const app = express();

const isProduction = process.env.NODE_ENV === "production";

// ============================================================
// TRUST PROXY
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

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],

    optionsSuccessStatus: 204,
  }),
);

// ============================================================
// BODY PARSER
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
// ROOT
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

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Server is healthy.",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
//
// Vercel is serverless.
//
// Every request that needs MongoDB must make sure the
// database connection and collections are initialized.
//
// connectDB() is cached inside config/db.js, so this does
// NOT create a new MongoDB connection on every request.
//
// ============================================================

app.use(async (req, res, next) => {
  try {
    await connectDB();

    next();
  } catch (error) {
    console.error("Database initialization failed:", error);

    return res.status(500).json({
      success: false,
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
// 404
// ============================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
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
      message: "Invalid JSON payload.",
    });
  }

  // ----------------------------------------------------------
  // Generic error
  // ----------------------------------------------------------

  const statusCode = err.statusCode || err.status || 500;

  const message =
    isProduction && statusCode === 500
      ? "Internal server error."
      : err.message || "Something went wrong.";

  return res.status(statusCode).json({
    success: false,
    message,
  });
});

// ============================================================
// EXPORT
// ============================================================

export default app;
