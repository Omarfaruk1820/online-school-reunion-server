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
// HELPER FUNCTIONS
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

const normalizeClassLevel = (value) => {
  return normalizeString(value);
};

const normalizeStudentType = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeDepartment = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeTShirtSize = (value) => {
  return normalizeString(value).toUpperCase();
};

const isValidPhone = (phone) => {
  return /^01[3-9]\d{8}$/.test(phone);
};

const isValidBatchYear = (year) => {
  const numericYear = Number(year);

  return (
    Number.isInteger(numericYear) &&
    numericYear >= MIN_BATCH_YEAR &&
    numericYear <= MAX_BATCH_YEAR
  );
};

const isValidObjectId = (value) => {
  return ObjectId.isValid(value);
};

const createRegistrationId = () => {
  return `SR-2027-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
};

const serializeDocument = (document) => {
  if (!document) {
    return document;
  }

  return {
    ...document,
    _id: document._id?.toString(),
  };
};

const getAuthenticatedUser = (req) => {
  return req.user || req.userData || null;
};

const getAuthenticatedUid = (req) => {
  const user = getAuthenticatedUser(req);

  return normalizeString(user?.uid);
};

const getAuthenticatedEmail = (req) => {
  const user = getAuthenticatedUser(req);

  return normalizeEmail(user?.email);
};

// ============================================================
// ROUTE TEST
// GET /api/registrations/test
// ============================================================

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Registrations route is working.",
    route: "/api/registrations/test",
  });
});

// ============================================================
// GET ACTIVE REUNION
// GET /api/registrations
// ============================================================

router.get("/", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

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
    console.error("GET ACTIVE REUNION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-load-failed",
      message: "Failed to load reunion event.",
    });
  }
});

// ============================================================
// POST REGISTRATION
// POST /api/registrations/register
// ============================================================

router.post("/register", verifyToken, async (req, res) => {
  try {
    // ======================================================
    // AUTHENTICATION
    // ======================================================

    const uid = getAuthenticatedUid(req);
    const authenticatedEmail = getAuthenticatedEmail(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    if (!authenticatedEmail) {
      return res.status(401).json({
        success: false,
        code: "auth/email-required",
        message: "A verified email address is required.",
      });
    }

    // ======================================================
    // REQUEST BODY
    // ======================================================

    const {
      participant = {},
      schoolInfo = {},
      reunion = {},
      consent = {},
    } = req.body || {};

    // ======================================================
    // PARTICIPANT
    // ======================================================

    const name = normalizeString(participant.name);

    const email = normalizeEmail(participant.email);

    const phone = normalizeString(participant.phone);

    const district = normalizeString(participant.district);

    const city = normalizeString(participant.city);

    // ======================================================
    // SCHOOL INFORMATION
    // ======================================================

    const studentType = normalizeStudentType(schoolInfo.studentType);

    const classLevel = normalizeClassLevel(schoolInfo.classLevel);

    const batchYear = Number(schoolInfo.batchYear);

    const department = normalizeDepartment(schoolInfo.department);

    // ======================================================
    // REUNION INFORMATION
    // ======================================================

    const eventId = normalizeString(reunion.eventId);

    const packageId = normalizeString(reunion.packageId);

    const tshirtSize = normalizeTShirtSize(reunion.tShirt?.size);

    const agreedToRules = consent.agreedToRules === true;

    // ======================================================
    // PARTICIPANT VALIDATION
    // ======================================================

    if (name.length < 3 || name.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/name",
        message: "Name must be between 3 and 100 characters.",
      });
    }

    if (email !== authenticatedEmail) {
      return res.status(400).json({
        success: false,
        code: "validation/email-mismatch",
        message:
          "Participant email must match the authenticated account email.",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        code: "validation/phone",
        message: "Please provide a valid Bangladesh mobile phone number.",
      });
    }

    if (!district) {
      return res.status(400).json({
        success: false,
        code: "validation/district",
        message: "District is required.",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        code: "validation/city",
        message: "City is required.",
      });
    }

    // ======================================================
    // SCHOOL INFORMATION VALIDATION
    // ======================================================

    if (!VALID_STUDENT_TYPES.has(studentType)) {
      return res.status(400).json({
        success: false,
        code: "validation/student-type",
        message: "Student type must be either current or alumni.",
      });
    }

    if (!VALID_CLASS_LEVELS.has(classLevel)) {
      return res.status(400).json({
        success: false,
        code: "validation/class-level",
        message: "Class level must be between 6 and 10.",
      });
    }

    if (!isValidBatchYear(batchYear)) {
      return res.status(400).json({
        success: false,
        code: "validation/batch-year",
        message: `Batch year must be between ${MIN_BATCH_YEAR} and ${MAX_BATCH_YEAR}.`,
      });
    }

    // ======================================================
    // DEPARTMENT
    // ======================================================

    const requiresDepartment = classLevel === "9" || classLevel === "10";

    if (requiresDepartment) {
      if (!VALID_DEPARTMENTS.has(department)) {
        return res.status(400).json({
          success: false,
          code: "validation/department",
          message: "A valid department is required for class 9 or 10.",
        });
      }
    }

    // ======================================================
    // EVENT VALIDATION
    // ======================================================

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id",
        message: "Reunion event ID is required.",
      });
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id",
        message: "Invalid reunion event ID.",
      });
    }

    // ======================================================
    // PACKAGE VALIDATION
    // ======================================================

    if (!packageId) {
      return res.status(400).json({
        success: false,
        code: "validation/package-id",
        message: "Gift package ID is required.",
      });
    }

    if (!tshirtSize) {
      return res.status(400).json({
        success: false,
        code: "validation/tshirt-size",
        message: "T-shirt size is required.",
      });
    }

    if (!VALID_TSHIRT_SIZES.has(tshirtSize)) {
      return res.status(400).json({
        success: false,
        code: "validation/tshirt-size",
        message: "Invalid T-shirt size.",
      });
    }

    // ======================================================
    // CONSENT
    // ======================================================

    if (!agreedToRules) {
      return res.status(400).json({
        success: false,
        code: "validation/consent",
        message: "You must agree to the reunion rules and terms.",
      });
    }

    // ======================================================
    // DATABASE
    // ======================================================

    await connectDB();

    const {
      users,
      reunionEvents,
      giftPackages,
      reunionRegistrations,
      studentProfiles,
      alumniProfiles,
    } = getCollections();

    // ======================================================
    // FIND EVENT
    // ======================================================

    const eventObjectId = new ObjectId(eventId);

    const event = await reunionEvents.findOne({
      _id: eventObjectId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event was not found.",
      });
    }

    // ======================================================
    // REGISTRATION STATUS
    // ======================================================

    if (event.registrationOpen !== true) {
      return res.status(403).json({
        success: false,
        code: "reunion/registration-closed",
        message: "Registration for this reunion is currently closed.",
      });
    }

    // ======================================================
    // REGISTRATION DEADLINE
    // ======================================================

    if (event.registrationDeadline) {
      const deadline = new Date(event.registrationDeadline);

      if (!Number.isNaN(deadline.getTime()) && new Date() > deadline) {
        return res.status(403).json({
          success: false,
          code: "reunion/registration-deadline",
          message: "The registration deadline has passed.",
        });
      }
    }

    // ======================================================
    // FIND GIFT PACKAGE
    // ======================================================

    let packageQuery;

    if (isValidObjectId(packageId)) {
      packageQuery = {
        $or: [
          {
            _id: new ObjectId(packageId),
          },
          {
            id: packageId,
          },
          {
            packageId,
          },
        ],
      };
    } else {
      packageQuery = {
        $or: [
          {
            id: packageId,
          },
          {
            packageId,
          },
        ],
      };
    }

    const giftPackage = await giftPackages.findOne({
      ...packageQuery,

      active: {
        $ne: false,
      },
    });

    if (!giftPackage) {
      return res.status(404).json({
        success: false,
        code: "reunion/package-not-found",
        message: "The selected gift package was not found or is inactive.",
      });
    }

    // ======================================================
    // DUPLICATE REGISTRATION
    // ======================================================

    const existingRegistration = await reunionRegistrations.findOne({
      uid,

      "reunion.eventId": eventObjectId,
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        code: "reunion/already-registered",
        message: "You are already registered for this reunion.",

        data: {
          registrationId: existingRegistration.registrationId || null,

          databaseId: existingRegistration._id?.toString() || null,

          status: existingRegistration.status || "confirmed",
        },
      });
    }

    // ======================================================
    // CURRENT TIME
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
          email: authenticatedEmail,
          name,
          phone,
          district,
          city,
          updatedAt: now,
        },

        $setOnInsert: {
          uid,
          role: "student",
          status: "active",
          createdAt: now,
        },
      },

      {
        upsert: true,
      },
    );

    // ======================================================
    // REGISTRATION ID
    // ======================================================

    const registrationId = createRegistrationId();

    // ======================================================
    // REGISTRATION DOCUMENT
    // ======================================================

    const registrationDocument = {
      registrationId,

      uid,

      participant: {
        name,
        email: authenticatedEmail,
        phone,
        district,
        city,
      },

      schoolInfo: {
        studentType,
        classLevel,
        batchYear,
        department: requiresDepartment ? department : null,
      },

      reunion: {
        eventId: eventObjectId,

        packageId,

        packageDatabaseId: giftPackage._id?.toString() || null,

        tShirt: {
          size: tshirtSize,
        },
      },

      consent: {
        agreedToRules: true,
        agreedAt: now,
      },

      status: "confirmed",

      paymentStatus:
        event.paymentRequired === true ? "pending" : "not-required",

      createdAt: now,
      updatedAt: now,
    };

    // ======================================================
    // INSERT REGISTRATION
    // ======================================================

    let registrationResult;

    try {
      registrationResult =
        await reunionRegistrations.insertOne(registrationDocument);
    } catch (error) {
      // Duplicate key race condition
      if (error?.code === 11000) {
        const duplicateRegistration = await reunionRegistrations.findOne({
          uid,

          "reunion.eventId": eventObjectId,
        });

        return res.status(409).json({
          success: false,
          code: "reunion/already-registered",
          message: "You are already registered for this reunion.",

          data: {
            registrationId: duplicateRegistration?.registrationId || null,
          },
        });
      }

      throw error;
    }

    // ======================================================
    // PROFILE DATA
    // ======================================================

    const profileData = {
      uid,
      name,
      email: authenticatedEmail,
      phone,
      district,
      city,
      classLevel,
      batchYear,

      department: requiresDepartment ? department : null,

      updatedAt: now,
    };

    // ======================================================
    // STUDENT PROFILE
    // ======================================================

    if (studentType === "current") {
      await studentProfiles.updateOne(
        {
          uid,
        },

        {
          $set: profileData,

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
          $set: profileData,

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
    // SUCCESS
    // ======================================================

    return res.status(201).json({
      success: true,

      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        databaseId: registrationResult.insertedId.toString(),

        eventId,

        status: registrationDocument.status,

        paymentStatus: registrationDocument.paymentStatus,
      },
    });
  } catch (error) {
    console.error("POST REUNION REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/registration-failed",
      message: "Failed to complete reunion registration.",
    });
  }
});

// ============================================================
// GET MY REGISTRATION
// GET /api/registrations/my-registration
// ============================================================

router.get("/my-registration", verifyToken, async (req, res) => {
  try {
    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    await connectDB();

    const { reunionRegistrations, reunionEvents } = getCollections();

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
        code: "reunion/registration-not-found",
        message: "No reunion registration was found for your account.",
      });
    }

    let event = null;

    const registrationEventId = registration.reunion?.eventId;

    if (registrationEventId && ObjectId.isValid(registrationEventId)) {
      event = await reunionEvents.findOne({
        _id: new ObjectId(registrationEventId),
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        registration: serializeDocument(registration),

        event: serializeDocument(event),
      },
    });
  } catch (error) {
    console.error("GET MY REUNION REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/my-registration-load-failed",
      message: "Failed to load your reunion registration.",
    });
  }
});

// ============================================================
// EXPORT ROUTER
// ============================================================

export default router;
