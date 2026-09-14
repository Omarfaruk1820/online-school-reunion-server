import express from "express";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

// ============================================================
// CONSTANTS
// ============================================================

const VALID_CLASS_LEVELS = new Set(["6", "7", "8", "9", "10"]);

const VALID_STUDENT_TYPES = new Set(["current", "alumni"]);

const VALID_DEPARTMENTS = new Set([
  "science",
  "commerce",
  "humanities",
  "vocational",
]);

const VALID_TSHIRT_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL", "3XL"]);

const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEAR = 2100;

// ============================================================
// HELPERS
// ============================================================

const normalizeString = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const normalizeEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const isValidBangladeshPhone = (phone) => {
  return /^01[3-9]\d{8}$/.test(phone);
};

const isValidBatchYear = (year) => {
  return (
    Number.isInteger(year) && year >= MIN_BATCH_YEAR && year <= MAX_BATCH_YEAR
  );
};

const generateRegistrationId = () => {
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `SR-2027-${randomPart}`;
};

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  return {
    ...document,
    _id: document._id ? document._id.toString() : undefined,
  };
};

// ============================================================
// GET CURRENT REUNION EVENT
// GET /api/reunion
// ============================================================

router.get("/reunion", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    const event = await reunionEvents.findOne(
      {
        registrationOpen: true,
      },
      {
        sort: {
          eventDate: 1,
          createdAt: -1,
        },
      },
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "No active reunion event was found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeDocument(event),
    });
  } catch (error) {
    console.error("GET REUNION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-load-failed",
      message: "Failed to load reunion event.",
    });
  }
});

// ============================================================
// POST REUNION REGISTRATION
// POST /api/reunion/register
// ============================================================

router.post("/reunion/register", verifyToken, async (req, res) => {
  try {
    await connectDB();

    const {
      users,
      studentProfiles,
      alumniProfiles,
      reunionEvents,
      reunionRegistrations,
      giftPackages,
    } = getCollections();

    // ======================================================
    // AUTHENTICATED USER
    // ======================================================

    const firebaseUser = req.user;

    if (!firebaseUser?.uid) {
      return res.status(401).json({
        success: false,
        code: "auth/user-missing",
        message: "Authenticated user information is missing.",
      });
    }

    const uid = firebaseUser.uid;

    // Firebase token is the source of truth.
    const email = normalizeEmail(firebaseUser.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        code: "auth/email-missing",
        message: "Authenticated email is required.",
      });
    }

    // ======================================================
    // REQUEST DATA
    // ======================================================

    const participant = req.body?.participant || {};
    const schoolInfo = req.body?.schoolInfo || {};
    const reunion = req.body?.reunion || {};
    const consent = req.body?.consent || {};

    const name = normalizeString(participant.name);
    const phone = normalizeString(participant.phone);
    const district = normalizeString(participant.district);
    const city = normalizeString(participant.city);

    const studentType = normalizeString(schoolInfo.studentType);

    const classLevel = normalizeString(schoolInfo.classLevel);

    const batchYear = Number(schoolInfo.batchYear);

    const department =
      schoolInfo.department === null || schoolInfo.department === undefined
        ? null
        : normalizeString(schoolInfo.department);

    const eventId = normalizeString(reunion.eventId);

    const packageId = normalizeString(reunion.packageId);

    const tShirtSize = normalizeString(reunion?.tShirt?.size);

    // ======================================================
    // BASIC VALIDATION
    // ======================================================

    if (!name || name.length < 3) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-name",
        message: "Full name must be at least 3 characters.",
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/name-too-long",
        message: "Full name must not exceed 100 characters.",
      });
    }

    if (!isValidBangladeshPhone(phone)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-phone",
        message: "Please provide a valid Bangladesh mobile number.",
      });
    }

    if (!district) {
      return res.status(400).json({
        success: false,
        code: "validation/district-required",
        message: "District is required.",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        code: "validation/city-required",
        message: "City is required.",
      });
    }

    if (!VALID_STUDENT_TYPES.has(studentType)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-student-type",
        message: "Invalid participant type.",
      });
    }

    if (!VALID_CLASS_LEVELS.has(classLevel)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-class-level",
        message: "Invalid class level.",
      });
    }

    if (!isValidBatchYear(batchYear)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-batch-year",
        message: "Invalid batch year.",
      });
    }

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/event-required",
        message: "Reunion event is required.",
      });
    }

    if (!packageId) {
      return res.status(400).json({
        success: false,
        code: "validation/package-required",
        message: "Reunion package is required.",
      });
    }

    if (!VALID_TSHIRT_SIZES.has(tShirtSize)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-tshirt-size",
        message: "Invalid T-shirt size.",
      });
    }

    // ======================================================
    // DEPARTMENT VALIDATION
    // ======================================================

    const departmentRequired = classLevel === "9" || classLevel === "10";

    if (departmentRequired) {
      if (!VALID_DEPARTMENTS.has(department)) {
        return res.status(400).json({
          success: false,
          code: "validation/department-required",
          message: "Department is required for Class 9 and Class 10.",
        });
      }
    }

    const finalDepartment = departmentRequired ? department : null;

    // ======================================================
    // CONSENT
    // ======================================================

    if (consent.agreedToRules !== true) {
      return res.status(400).json({
        success: false,
        code: "validation/consent-required",
        message: "You must agree to the reunion registration guidelines.",
      });
    }

    // ======================================================
    // EVENT ID VALIDATION
    // ======================================================

    if (!ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
        message: "Invalid reunion event ID.",
      });
    }

    const eventObjectId = new ObjectId(eventId);

    // ======================================================
    // FIND REUNION EVENT
    // ======================================================

    const reunionEvent = await reunionEvents.findOne({
      _id: eventObjectId,
    });

    if (!reunionEvent) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event not found.",
      });
    }

    // ======================================================
    // REGISTRATION STATUS
    // ======================================================

    if (reunionEvent.registrationOpen !== true) {
      return res.status(403).json({
        success: false,
        code: "registration/closed",
        message: "Registration for this reunion is currently closed.",
      });
    }

    // ======================================================
    // REGISTRATION DEADLINE
    // ======================================================

    if (reunionEvent.registrationDeadline) {
      const deadline = new Date(reunionEvent.registrationDeadline);

      if (
        !Number.isNaN(deadline.getTime()) &&
        Date.now() > deadline.getTime()
      ) {
        return res.status(403).json({
          success: false,
          code: "registration/deadline-passed",
          message: "The reunion registration deadline has passed.",
        });
      }
    }

    // ======================================================
    // VALIDATE GIFT PACKAGE
    // ======================================================

    const selectedPackage = await giftPackages.findOne({
      $or: [
        {
          id: packageId,
        },
        {
          packageId,
        },
      ],
      active: {
        $ne: false,
      },
    });

    if (!selectedPackage) {
      return res.status(400).json({
        success: false,
        code: "registration/invalid-package",
        message: "The selected reunion package is not available.",
      });
    }

    // ======================================================
    // CHECK DUPLICATE REGISTRATION
    // ======================================================

    const existingRegistration = await reunionRegistrations.findOne({
      eventId,
      uid,
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        code: "registration/already-exists",
        message: "You have already registered for this reunion.",
        data: {
          registrationId: existingRegistration.registrationId,
        },
      });
    }

    // ======================================================
    // TIMESTAMP
    // ======================================================

    const now = new Date();

    // ======================================================
    // UPSERT USER
    // ======================================================

    await users.updateOne(
      {
        uid,
      },
      {
        $set: {
          email,

          name: firebaseUser.name || name,

          phone,

          photoURL: firebaseUser.picture || "",

          emailVerified: firebaseUser.emailVerified === true,

          provider: firebaseUser.provider || "password",

          updatedAt: now,
        },

        $setOnInsert: {
          uid,
          role: "user",
          createdAt: now,
        },
      },
      {
        upsert: true,
      },
    );

    // ======================================================
    // GENERATE REGISTRATION ID
    // ======================================================

    const registrationId = generateRegistrationId();

    // ======================================================
    // REGISTRATION DOCUMENT
    // ======================================================

    const registrationDocument = {
      registrationId,

      uid,

      eventId,

      participant: {
        name,
        email,
        phone,
        district,
        city,
      },

      schoolInfo: {
        studentType,
        classLevel,
        batchYear,
        department: finalDepartment,
      },

      reunion: {
        eventId,

        packageId,

        packageName: selectedPackage.name || "",

        tShirt: {
          size: tShirtSize,
        },
      },

      consent: {
        agreedToRules: true,
        agreedAt: now,
      },

      status: "confirmed",

      attendanceStatus: "not_checked_in",

      paymentStatus:
        reunionEvent.paymentRequired === true ? "pending" : "not_required",

      giftsStatus: "pending",

      createdAt: now,
      updatedAt: now,
    };

    // ======================================================
    // INSERT REGISTRATION
    // ======================================================

    const registrationInsert =
      await reunionRegistrations.insertOne(registrationDocument);

    // ======================================================
    // PROFILE DOCUMENT
    // ======================================================

    const profileDocument = {
      uid,
      name,
      email,
      phone,
      district,
      city,
      classLevel,
      batchYear,
      department: finalDepartment,
      updatedAt: now,
    };

    // ======================================================
    // CURRENT STUDENT PROFILE
    // ======================================================

    if (studentType === "current") {
      await studentProfiles.updateOne(
        {
          uid,
        },
        {
          $set: profileDocument,

          $setOnInsert: {
            uid,
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      );
    }

    // ======================================================
    // ALUMNI PROFILE
    // ======================================================

    if (studentType === "alumni") {
      await alumniProfiles.updateOne(
        {
          uid,
        },
        {
          $set: profileDocument,

          $setOnInsert: {
            uid,
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      );
    }

    // ======================================================
    // SUCCESS RESPONSE
    // ======================================================

    return res.status(201).json({
      success: true,

      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        databaseId: registrationInsert.insertedId.toString(),

        eventId,

        status: "confirmed",

        paymentStatus:
          reunionEvent.paymentRequired === true ? "pending" : "not_required",
      },
    });
  } catch (error) {
    // ======================================================
    // DUPLICATE KEY ERROR
    // ======================================================

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "registration/already-exists",
        message: "You have already registered for this reunion.",
      });
    }

    // ======================================================
    // SERVER ERROR
    // ======================================================

    console.error("REUNION REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "registration/server-error",
      message: "Registration could not be completed. Please try again.",
    });
  }
});

// ============================================================
// GET MY REGISTRATION
// GET /api/reunion/my-registration
// ============================================================

router.get("/reunion/my-registration", verifyToken, async (req, res) => {
  try {
    await connectDB();

    const { reunionRegistrations, reunionEvents } = getCollections();

    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/user-missing",
        message: "Authenticated user information is missing.",
      });
    }

    // ======================================================
    // FIND USER'S LATEST REGISTRATION
    // ======================================================

    const registration = await reunionRegistrations.findOne(
      {
        uid,
      },
      {
        sort: {
          createdAt: -1,
        },
      },
    );

    if (!registration) {
      return res.status(404).json({
        success: false,
        code: "registration/not-found",
        message: "No reunion registration was found.",
      });
    }

    // ======================================================
    // FIND RELATED EVENT
    // ======================================================

    let event = null;

    if (registration.eventId && ObjectId.isValid(registration.eventId)) {
      event = await reunionEvents.findOne({
        _id: new ObjectId(registration.eventId),
      });
    }

    // ======================================================
    // SUCCESS RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,

      data: {
        ...serializeDocument(registration),

        event: serializeDocument(event),
      },
    });
  } catch (error) {
    console.error("GET MY REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "registration/load-failed",
      message: "Failed to load your reunion registration.",
    });
  }
});

// ============================================================
// EXPORT
// ============================================================

export default router;
