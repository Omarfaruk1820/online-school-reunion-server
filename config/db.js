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
let reunionRegistrations = null;
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
  // Already connected
  if (db) {
    return db;
  }

  // Connection already in progress
  if (connectionPromise) {
    return connectionPromise;
  }

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
      // Select Database
      // --------------------------------------------------------

      db = client.db(dbName);

      // --------------------------------------------------------
      // Initialize Collections
      // --------------------------------------------------------

      users = db.collection("users");

      studentProfiles = db.collection("studentProfiles");

      alumniProfiles = db.collection("alumniProfiles");

      reunionEvents = db.collection("reunionEvents");

      reunionRegistrations = db.collection("reunionRegistrations");

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

      // --------------------------------------------------------
      // Users Indexes
      // --------------------------------------------------------

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

      // --------------------------------------------------------
      // Success Logs
      // --------------------------------------------------------

      console.log(`MongoDB connected successfully. Database: ${dbName}`);

      console.log("MongoDB collections initialized.");

      return db;
    } catch (error) {
      // Reset connection promise so future attempts
      // can reconnect.

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
    reunionRegistrations,
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
