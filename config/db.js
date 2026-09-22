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

  // Connection behavior
  maxPoolSize: 10,
  minPoolSize: 0,

  // Timeout settings
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
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
// SAFE INDEX CREATOR
// ============================================================

async function ensureIndex(collection, key, options = {}) {
  const indexes = await collection.listIndexes().toArray();

  const existingIndex = indexes.find((index) => {
    return JSON.stringify(index.key) === JSON.stringify(key);
  });

  // ----------------------------------------------------------
  // Existing index found
  // ----------------------------------------------------------

  if (existingIndex) {
    console.log(
      `Index already exists: ${collection.collectionName}.${existingIndex.name}`,
    );

    if (options.name && existingIndex.name !== options.name) {
      console.warn(
        `Index name mismatch detected for ${collection.collectionName}.`,
      );

      console.warn(`Existing index: ${existingIndex.name}`);
      console.warn(`Expected index: ${options.name}`);
      console.warn("Existing index will be reused.");
    }

    return existingIndex.name;
  }

  // ----------------------------------------------------------
  // Create new index
  // ----------------------------------------------------------

  const createdIndex = await collection.createIndex(key, options);

  console.log(`Index created: ${collection.collectionName}.${createdIndex}`);

  return createdIndex;
}

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
  // Connection already running
  // ----------------------------------------------------------

  if (connectionPromise) {
    return connectionPromise;
  }

  // ----------------------------------------------------------
  // Start connection
  // ----------------------------------------------------------

  connectionPromise = (async () => {
    try {
      console.log("Connecting to MongoDB...");

      await client.connect();

      // ------------------------------------------------------
      // Verify MongoDB connection
      // ------------------------------------------------------

      await client.db("admin").command({
        ping: 1,
      });

      console.log("MongoDB ping successful.");

      // ------------------------------------------------------
      // Select database
      // ------------------------------------------------------

      db = client.db(dbName);

      // ------------------------------------------------------
      // Initialize collections
      // ------------------------------------------------------

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

      // ======================================================
      // USERS INDEXES
      // ======================================================

      await ensureIndex(
        users,
        { uid: 1 },
        {
          unique: true,
          name: "unique_firebase_uid",
        },
      );

      await ensureIndex(
        users,
        { email: 1 },
        {
          name: "email_index",
        },
      );

      // ======================================================
      // REGISTRATIONS INDEXES
      // ======================================================

      // ------------------------------------------------------
      // Remove old indexes that used the wrong field:
      // eventId
      //
      // Current registration schema uses:
      // reunion.eventId
      // ------------------------------------------------------

      await registrations
        .dropIndex("unique_registration_per_event_user")
        .catch(() => {});

      await registrations
        .dropIndex("event_registration_status")
        .catch(() => {});

      // ------------------------------------------------------
      // One registration per user per reunion event
      // ------------------------------------------------------

      await ensureIndex(
        registrations,
        {
          "reunion.eventId": 1,
          uid: 1,
        },
        {
          unique: true,
          name: "unique_registration_per_event_user",
        },
      );

      // ------------------------------------------------------
      // Registration ID must always be unique
      // Example:
      // SR-2027-BF8F1CA724
      // ------------------------------------------------------

      await ensureIndex(
        registrations,
        { registrationId: 1 },
        {
          unique: true,
          name: "unique_registration_id",
        },
      );

      // ------------------------------------------------------
      // User registration history
      // Useful for:
      // GET /my-registration
      // GET /my-events
      // Dashboard
      // ------------------------------------------------------

      await ensureIndex(
        registrations,
        {
          uid: 1,
          createdAt: -1,
        },
        {
          name: "user_registration_history",
        },
      );

      // ------------------------------------------------------
      // Event registration status
      // Useful for:
      // capacity checking
      // admin statistics
      // confirmed/cancelled filtering
      // ------------------------------------------------------

      await ensureIndex(
        registrations,
        {
          "reunion.eventId": 1,
          status: 1,
        },
        {
          name: "event_registration_status",
        },
      );

      // ======================================================
      // SUCCESS
      // ======================================================

      console.log(`MongoDB connected successfully. Database: ${dbName}`);

      console.log("MongoDB collections initialized successfully.");

      return db;
    } catch (error) {
      // ------------------------------------------------------
      // Reset connection state on failure
      // ------------------------------------------------------

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
