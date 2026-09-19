import express from "express";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

/* =========================================================
   CONSTANTS
========================================================= */

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

/* =========================================================
   HELPERS
========================================================= */

const normalizeString = (value) => {
  if (typeof value !== "string") return "";
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
  if (!document) return document;

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

/* =========================================================
   TEST ROUTE
   GET /api/registrations/test
========================================================= */

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Registrations route is working.",
    route: "/api/registrations/test",
  });
});

/* =========================================================
   GET ACTIVE REUNION EVENT
   GET /api/registrations
========================================================= */

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
    console.error("GET ACTIVE REUNION EVENT ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-load-failed",
      message: "Failed to load reunion event.",
    });
  }
});

/* =========================================================
   POST REGISTRATION
   POST /api/registrations/register
========================================================= */

router.post("/register", verifyToken, async (req, res) => {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const uid = getAuthenticatedUid();
    const authenticatedEmail = getAuthenticatedEmail();

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
        message: "A valid authenticated email address is required.",
      });
    }

    /* -------------------------------------------------------
       REQUEST BODY
    ------------------------------------------------------- */

    const {
      participant = {},
      schoolInfo = {},
      reunion = {},
      consent = {},
    } = req.body || {};

    /* -------------------------------------------------------
       PARTICIPANT
    ------------------------------------------------------- */

    const name = normalizeString(participant.name);
    const email = normalizeEmail(participant.email);
    const phone = normalizeString(participant.phone);
    const district = normalizeString(participant.district);
    const city = normalizeString(participant.city);

    /* -------------------------------------------------------
       SCHOOL INFORMATION
    ------------------------------------------------------- */

    const studentType = normalizeStudentType(schoolInfo.studentType);

    const classLevel = normalizeClassLevel(schoolInfo.classLevel);

    const batchYear = Number(schoolInfo.batchYear);

    const department = normalizeDepartment(schoolInfo.department);

    /* -------------------------------------------------------
       REUNION INFORMATION
    ------------------------------------------------------- */

    const eventId = normalizeString(reunion.eventId);

    const packageId = normalizeString(reunion.packageId);

    const tshirtSize = normalizeTShirtSize(reunion.tShirt?.size);

    /* -------------------------------------------------------
       CONSENT
    ------------------------------------------------------- */

    const agreedToRules = consent.agreedToRules === true;

    /* =======================================================
       VALIDATION
    ======================================================= */

    if (!name) {
      return res.status(400).json({
        success: false,
        code: "validation/name-required",
        message: "Name is required.",
      });
    }

    if (name.length < 3 || name.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/name-invalid",
        message: "Name must be between 3 and 100 characters.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        code: "validation/email-required",
        message: "Email is required.",
      });
    }

    if (email !== authenticatedEmail) {
      return res.status(403).json({
        success: false,
        code: "auth/email-mismatch",
        message:
          "Registration email must match the authenticated account email.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-required",
        message: "Phone number is required.",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        code: "validation/phone-invalid",
        message: "Please provide a valid Bangladeshi mobile number.",
      });
    }

    if (!district) {
      return res.status(400).json({
        success: false,
        code: "validation/district-required",
        message: "District is required.",
      });
    }

    if (district.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/district-invalid",
        message: "District is too long.",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        code: "validation/city-required",
        message: "City is required.",
      });
    }

    if (city.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/city-invalid",
        message: "City is too long.",
      });
    }

    if (!VALID_STUDENT_TYPES.has(studentType)) {
      return res.status(400).json({
        success: false,
        code: "validation/student-type-invalid",
        message: "Student type must be either current or alumni.",
      });
    }

    if (!VALID_CLASS_LEVELS.has(classLevel)) {
      return res.status(400).json({
        success: false,
        code: "validation/class-level-invalid",
        message: "Class level must be between 6 and 10.",
      });
    }

    if (!isValidBatchYear(batchYear)) {
      return res.status(400).json({
        success: false,
        code: "validation/batch-year-invalid",
        message: "Please provide a valid batch year.",
      });
    }

    const requiresDepartment = classLevel === "9" || classLevel === "10";

    if (requiresDepartment) {
      if (!VALID_DEPARTMENTS.has(department)) {
        return res.status(400).json({
          success: false,
          code: "validation/department-invalid",
          message: "A valid department is required for class 9 or 10.",
        });
      }
    }

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id-required",
        message: "Reunion event is required.",
      });
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id-invalid",
        message: "Invalid reunion event ID.",
      });
    }

    if (!packageId) {
      return res.status(400).json({
        success: false,
        code: "validation/package-required",
        message: "Reunion package is required.",
      });
    }

    if (packageId.length > 100) {
      return res.status(400).json({
        success: false,
        code: "validation/package-invalid",
        message: "Invalid reunion package.",
      });
    }

    if (!VALID_TSHIRT_SIZES.has(tshirtSize)) {
      return res.status(400).json({
        success: false,
        code: "validation/tshirt-size-invalid",
        message: "Please select a valid T-shirt size.",
      });
    }

    if (!agreedToRules) {
      return res.status(400).json({
        success: false,
        code: "validation/consent-required",
        message: "You must agree to the reunion rules.",
      });
    }

    /* =======================================================
       DATABASE
    ======================================================= */

    await connectDB();

    const {
      users,
      reunionEvents,
      giftPackages,
      registrations,
      studentProfiles,
      alumniProfiles,
    } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Registrations collection is unavailable.",
      });
    }

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

    /* =======================================================
       FIND EVENT
    ======================================================= */

    const eventObjectId = new ObjectId(eventId);

    const event = await reunionEvents.findOne({
      _id: eventObjectId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "The selected reunion event was not found.",
      });
    }

    if (event.registrationOpen !== true) {
      return res.status(403).json({
        success: false,
        code: "reunion/registration-closed",
        message: "Registration for this reunion event is currently closed.",
      });
    }

    /* -------------------------------------------------------
       REGISTRATION DEADLINE
    ------------------------------------------------------- */

    if (event.registrationDeadline) {
      const deadline = new Date(event.registrationDeadline);

      if (!Number.isNaN(deadline.getTime()) && new Date() > deadline) {
        return res.status(403).json({
          success: false,
          code: "reunion/registration-deadline-passed",
          message: "The registration deadline has passed.",
        });
      }
    }

    /* =======================================================
       FIND GIFT PACKAGE
    ======================================================= */

    if (!giftPackages) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Gift packages collection is unavailable.",
      });
    }

    let giftPackage = null;

    if (ObjectId.isValid(packageId)) {
      const packageObjectId = new ObjectId(packageId);

      giftPackage = await giftPackages.findOne({
        $or: [{ _id: packageObjectId }, { id: packageId }, { packageId }],
        active: { $ne: false },
      });
    } else {
      giftPackage = await giftPackages.findOne({
        $or: [{ id: packageId }, { packageId }],
        active: { $ne: false },
      });
    }

    if (!giftPackage) {
      return res.status(404).json({
        success: false,
        code: "reunion/package-not-found",
        message: "The selected reunion package was not found.",
      });
    }

    /* =======================================================
       DUPLICATE REGISTRATION CHECK
    ======================================================= */

    const existingRegistration = await registrations.findOne({
      uid,
      "reunion.eventId": eventObjectId,
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        code: "reunion/already-registered",
        message: "You are already registered for this reunion.",
        data: {
          registrationId: existingRegistration.registrationId,
        },
      });
    }

    /* =======================================================
       UPDATE USER
    ======================================================= */

    const now = new Date();

    if (users) {
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
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      );
    }

    /* =======================================================
       CREATE REGISTRATION ID
    ======================================================= */

    const registrationId = createRegistrationId();

    /* =======================================================
       REGISTRATION DOCUMENT
    ======================================================= */

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

        packageName: giftPackage.name || giftPackage.title || null,

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

    /* =======================================================
       INSERT REGISTRATION
    ======================================================= */

    let insertResult;

    try {
      insertResult = await registrations.insertOne(registrationDocument);
    } catch (error) {
      /* MongoDB duplicate key */

      if (error?.code === 11000) {
        const duplicate = await registrations.findOne({
          uid,
          "reunion.eventId": eventObjectId,
        });

        return res.status(409).json({
          success: false,
          code: "reunion/already-registered",
          message: "You are already registered for this reunion.",
          data: {
            registrationId: duplicate?.registrationId || null,
          },
        });
      }

      throw error;
    }

    /* =======================================================
       PROFILE DATA
    ======================================================= */

    const profileData = {
      uid,

      name,

      email: authenticatedEmail,

      phone,

      district,

      city,

      studentType,

      classLevel,

      batchYear,

      department: requiresDepartment ? department : null,

      reunionEventId: eventObjectId,

      registrationId,

      updatedAt: now,
    };

    if (studentType === "current") {
      if (studentProfiles) {
        await studentProfiles.updateOne(
          { uid },
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
    }

    if (studentType === "alumni") {
      if (alumniProfiles) {
        await alumniProfiles.updateOne(
          { uid },
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
    }

    /* =======================================================
       SUCCESS
    ======================================================= */

    return res.status(201).json({
      success: true,
      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        insertedId: insertResult.insertedId?.toString(),

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

/* =========================================================
   GET MY REGISTRATION
   GET /api/registrations/my-registration
========================================================= */

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

    const { registrations, reunionEvents } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Registrations collection is unavailable.",
      });
    }

    const registration = await registrations.findOne(
      { uid },
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

    const eventId = registration?.reunion?.eventId;

    if (reunionEvents && eventId && ObjectId.isValid(eventId)) {
      event = await reunionEvents.findOne({
        _id: typeof eventId === "string" ? new ObjectId(eventId) : eventId,
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
    console.error("GET MY REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/my-registration-load-failed",
      message: "Failed to load your registration.",
    });
  }
});

/* =========================================================
   GET REGISTRATION BY REGISTRATION ID
   GET /api/registrations/:registrationId
========================================================= */

router.get("/:registrationId", verifyToken, async (req, res) => {
  try {
    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    const registrationId = normalizeString(req.params.registrationId);

    if (!registrationId) {
      return res.status(400).json({
        success: false,
        code: "validation/registration-id-required",
        message: "Registration ID is required.",
      });
    }

    await connectDB();

    const { registrations, reunionEvents } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Registrations collection is unavailable.",
      });
    }

    const registration = await registrations.findOne({
      registrationId,
      uid,
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        code: "reunion/registration-not-found",
        message: "Registration was not found.",
      });
    }

    let event = null;

    const eventId = registration?.reunion?.eventId;

    if (reunionEvents && eventId && ObjectId.isValid(eventId)) {
      event = await reunionEvents.findOne({
        _id: typeof eventId === "string" ? new ObjectId(eventId) : eventId,
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
    console.error("GET REGISTRATION BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/registration-load-failed",
      message: "Failed to load registration.",
    });
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;
