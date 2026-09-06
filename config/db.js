import "./env.js";

import { MongoClient, ServerApiVersion } from "mongodb";

const username = process.env.DB_USERNAME;
const password = process.env.DB_PASS;
const dbName = process.env.MONGODB_DB_NAME || "school-reunion";

if (!username) {
  throw new Error("DB_USERNAME is missing.");
}

if (!password) {
  throw new Error("DB_PASS is missing.");
}

const uri =
  `mongodb+srv://${encodeURIComponent(username)}` +
  `:${encodeURIComponent(password)}` +
  `@cluster0.g29mryf.mongodb.net/` +
  `?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db = null;

let users = null;
let studentProfiles = null;
let alumniProfiles = null;
let reunionEvents = null;
let reunionRegistrations = null;
let giftPackages = null;

let connectionPromise = null;

async function connectDB() {
  if (db) {
    return db;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      await client.connect();

      await client.db("admin").command({
        ping: 1,
      });

      db = client.db(dbName);

      users = db.collection("users");

      studentProfiles = db.collection("studentProfiles");

      alumniProfiles = db.collection("alumniProfiles");

      reunionEvents = db.collection("reunionEvents");

      reunionRegistrations = db.collection("reunionRegistrations");

      giftPackages = db.collection("giftPackages");

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

      console.log(`MongoDB connected successfully. Database: ${dbName}`);

      console.log("MongoDB collections initialized.");

      return db;
    } catch (error) {
      connectionPromise = null;

      console.error("MongoDB connection failed:", error?.message || error);

      throw error;
    }
  })();

  return connectionPromise;
}

function getDB() {
  if (!db) {
    throw new Error("MongoDB is not connected. Call connectDB() first.");
  }

  return db;
}

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
  };
}

export { client, connectDB, getDB, getCollections };
