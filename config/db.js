import "./env.js";

import { MongoClient, ServerApiVersion } from "mongodb";

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const username = process.env.DB_USERNAME;
const password = process.env.DB_PASS;
const dbName = process.env.MONGODB_DB_NAME || "school-reunion";

if (!username) {
  throw new Error("DB_USERNAME is missing.");
}

if (!password) {
  throw new Error("DB_PASS is missing.");
}

// ============================================================
// MONGODB URI
// ============================================================

const uri =
  `mongodb+srv://${encodeURIComponent(username)}` +
  `:${encodeURIComponent(password)}` +
  `@cluster0.g29mryf.mongodb.net/` +
  `?appName=Cluster0`;

// ============================================================
// MONGODB CLIENT
// ============================================================

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ============================================================
// DATABASE
// ============================================================

let db = null;

// ============================================================
// COLLECTIONS
// ============================================================

let users = null;
let studentProfiles = null;
let alumniProfiles = null;
let reunionEvents = null;
let registrations = null;
let giftPackages = null;
let gifts = null;
let sponsors = null;
let schedules = null;
let attendance = null;
let announcements = null;
let gallery = null;
let batches = null;
let departments = null;
let contactMessages = null;

// ============================================================
// CONNECTION PROMISE
// ============================================================

let connectionPromise = null;

// ============================================================
// CONNECT DATABASE
// ============================================================

async function connectDB() {
  // ----------------------------------------------------------
  // Already connected
  // ----------------------------------------------------------

  if (db) {
    return db;
  }

  // ----------------------------------------------------------
  // Connection already in progress
  // ----------------------------------------------------------

  if (connectionPromise) {
    return connectionPromise;
  }

  // ----------------------------------------------------------
  // Start connection
  // ----------------------------------------------------------

  connectionPromise = (async () => {
    try {
      // --------------------------------------------------------
      // Connect MongoDB
      // --------------------------------------------------------

      await client.connect();

      // --------------------------------------------------------
      // Ping MongoDB
      // --------------------------------------------------------

      await client.db("admin").command({
        ping: 1,
      });

      // --------------------------------------------------------
      // Select Application Database
      // --------------------------------------------------------

      db = client.db(dbName);

      // --------------------------------------------------------
      // Initialize Collections
      // --------------------------------------------------------

      users = db.collection("users");

      studentProfiles = db.collection("studentProfiles");

      alumniProfiles = db.collection("alumniProfiles");

      reunionEvents = db.collection("reunionEvents");

      registrations = db.collection("registrations");

      giftPackages = db.collection("giftPackages");

      gifts = db.collection("gifts");

      sponsors = db.collection("sponsors");

      schedules = db.collection("schedules");

      attendance = db.collection("attendance");

      announcements = db.collection("announcements");

      gallery = db.collection("gallery");

      batches = db.collection("batches");

      departments = db.collection("departments");

      contactMessages = db.collection("contactMessages");

      // ========================================================
      // USERS INDEXES
      // ========================================================

      await users.createIndex(
        { uid: 1 },
        {
          unique: true,
          name: "unique_firebase_uid",
        },
      );

      await users.createIndex(
        { email: 1 },
        {
          name: "email_index",
        },
      );

      // ========================================================
      // REGISTRATIONS INDEXES
      // ========================================================

      // Prevent the same user from registering
      // multiple times for the same reunion event.
      await registrations.createIndex(
        { eventId: 1, uid: 1 },
        {
          unique: true,
          name: "unique_registration_per_event_user",
        },
      );

      // Every registration gets a unique public registration ID.
      await registrations.createIndex(
        { registrationId: 1 },
        {
          unique: true,
          name: "unique_registration_id",
        },
      );

      // Useful for loading a user's registration history.
      await registrations.createIndex(
        { uid: 1, createdAt: -1 },
        {
          name: "user_registration_history",
        },
      );

      // Useful for admin/event registration statistics.
      await registrations.createIndex(
        { eventId: 1, status: 1 },
        {
          name: "event_registration_status",
        },
      );

      // ========================================================
      // SUCCESS LOGS
      // ========================================================

      console.log(`MongoDB connected successfully. Database: ${dbName}`);

      console.log("MongoDB collections initialized successfully.");

      return db;
    } catch (error) {
      // --------------------------------------------------------
      // Reset state so a future request can retry connection.
      // --------------------------------------------------------

      db = null;
      connectionPromise = null;

      console.error("MongoDB connection failed:", error?.message || error);

      throw error;
    }
  })();

  return connectionPromise;
}

// ============================================================
// GET DATABASE
// ============================================================

function getDB() {
  if (!db) {
    throw new Error("MongoDB is not connected. Call connectDB() first.");
  }

  return db;
}

// ============================================================
// GET COLLECTIONS
// ============================================================

function getCollections() {
  if (!db) {
    throw new Error("MongoDB is not connected. Call connectDB() first.");
  }

  return {
    users,
    studentProfiles,
    alumniProfiles,
    reunionEvents,
    registrations,
    giftPackages,
    gifts,
    sponsors,
    schedules,
    attendance,
    announcements,
    gallery,
    batches,
    departments,
    contactMessages,
  };
}

// ============================================================
// EXPORT
// ============================================================

export { client, connectDB, getDB, getCollections };
