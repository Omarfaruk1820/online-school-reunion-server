import "./env.js";

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID is missing from .env");
}

if (!clientEmail) {
  throw new Error("FIREBASE_CLIENT_EMAIL is missing from .env");
}

if (!privateKey) {
  throw new Error("FIREBASE_PRIVATE_KEY is missing from .env");
}

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      });

console.log("Firebase Admin initialized successfully.");

const firebaseAuth = getAuth(firebaseApp);

export { firebaseApp, firebaseAuth };
