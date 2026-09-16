import "./config/env.js";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import registrationsRoutes from "./routes/registrations.routes.js";

const app = express();

// ============================================================
// ENVIRONMENT
// ============================================================

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

// ============================================================
// CORS
// ============================================================

const clientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

console.log("Allowed CORS origins:", clientUrls);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without Origin header
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (clientUrls.includes(normalizedOrigin)) {
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
// BASIC ROUTES
// ============================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "School Reunion Server is running.",
  });
});

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
// REGISTRATION ROUTES
// ============================================================

console.log("Registering registrations routes...");

app.use(
  "/api/registrations",
  (req, res, next) => {
    console.log(`REGISTRATIONS REQUEST: ${req.method} ${req.originalUrl}`);

    next();
  },
  registrationsRoutes,
);

console.log("Registrations routes registered successfully.");

// ============================================================
// 404 ROUTE
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

  // Invalid JSON
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      code: "request/invalid-json",
      message: "Invalid JSON payload.",
    });
  }

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
// LOCAL DEVELOPMENT SERVER
// ============================================================

const PORT = Number(process.env.PORT) || 5000;

if (!isProduction) {
  app.listen(PORT, () => {
    console.log(`School Reunion Server is running on port ${PORT}`);
  });
}

// ============================================================
// VERCEL / EXPRESS EXPORT
// ============================================================

export default app;
