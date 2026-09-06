const { MongoClient, ServerApiVersion } = require("mongodb");

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const username = process.env.DB_USERNAME;
const password = process.env.DB_PASS;
const dbName = process.env.MONGODB_DB_NAME || "school-reunion";

if (!username) {
  throw new Error("DB_USERNAME is missing from .env");
}

if (!password) {
  throw new Error("DB_PASS is missing from .env");
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
// DATABASE / COLLECTION REFERENCES
// ============================================================

let db = null;

let usersCollection = null;
let studentProfilesCollection = null;
let alumniProfilesCollection = null;
let reunionEventsCollection = null;
let reunionRegistrationsCollection = null;
let giftPackagesCollection = null;

// ============================================================
// CONNECT DATABASE
// ============================================================

async function connectDB() {
  try {
    if (db) {
      return db;
    }

    await client.connect();

    await client.db("admin").command({
      ping: 1,
    });

    db = client.db(dbName);

    // ----------------------------------------------------------
    // Collections
    // ----------------------------------------------------------

    usersCollection = db.collection("usersCollection");

    studentProfilesCollection = db.collection("studentProfilesCollection");

    alumniProfilesCollection = db.collection("alumniProfilesCollection");

    reunionEventsCollection = db.collection("reunionEventsCollection");

    reunionRegistrationsCollection = db.collection(
      "reunionRegistrationsCollection",
    );

    giftPackagesCollection = db.collection("giftPackagesCollection");

    // ----------------------------------------------------------
    // Indexes
    // ----------------------------------------------------------

    await usersCollection.createIndex(
      { uid: 1 },
      {
        unique: true,
        name: "unique_firebase_uid",
      },
    );

    await usersCollection.createIndex(
      { email: 1 },
      {
        name: "email_index",
      },
    );

    console.log(`MongoDB connected successfully. Database: ${dbName}`);

    console.log("MongoDB collections initialized.");

    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);

    throw error;
  }
}

// ============================================================
// GET DATABASE
// ============================================================

function getDB() {
  if (!db) {
    throw new Error("MongoDB is not connected.");
  }

  return db;
}

// ============================================================
// GET COLLECTIONS
// ============================================================

function getCollections() {
  if (!db) {
    throw new Error("MongoDB is not connected.");
  }

  return {
    usersCollection,
    studentProfilesCollection,
    alumniProfilesCollection,
    reunionEventsCollection,
    reunionRegistrationsCollection,
    giftPackagesCollection,
  };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  client,
  connectDB,
  getDB,
  getCollections,
};
