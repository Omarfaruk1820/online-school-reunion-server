import express from "express";
import crypto from "crypto";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

/* ============================================================
   CONSTANTS
============================================================ */

const VALID_CLASS_LEVELS = new Set(["6", "7", "8", "9", "10"]);

const VALID_STUDENT_TYPES = new Set(["current", "alumni"]);

const VALID_DEPARTMENTS = new Set([
  "science",
  "commerce",
  "humanities",
  "vocational",
]);

/*
 * Standard T-shirt size naming.
 *
 * Frontend uses 2XL, so backend also uses 2XL.
 */
const VALID_TSHIRT_SIZES = new Set(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);

const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEAR = 2100;

/* ============================================================
   NORMALIZERS
============================================================ */

const normalizeString = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const normalizeEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeStudentType = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeClassLevel = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return String(value).trim();
};

const normalizeDepartment = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeTshirtSize = (value) => {
  const normalized = normalizeString(value).toUpperCase();

  /*
   * Backward compatibility:
   *
   * Old data/frontend may use XXL.
   * Internally we standardize it to 2XL.
   */
  if (normalized === "XXL") {
    return "2XL";
  }

  return normalized;
};

const normalizePhone = (value) => {
  return normalizeString(value).replace(/\s+/g, "");
};

const normalizeBatchYear = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const year = Number(value);

  if (!Number.isInteger(year)) {
    return null;
  }

  return year;
};

/* ============================================================
   VALIDATORS
============================================================ */

const isValidPhone = (phone) => {
  return /^01[3-9]\d{8}$/.test(phone);
};

const isValidObjectId = (value) => {
  return ObjectId.isValid(value);
};

const toObjectId = (value) => {
  if (!isValidObjectId(value)) {
    return null;
  }

  return new ObjectId(value);
};

/* ============================================================
   SERIALIZER
============================================================ */

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  return {
    ...document,

    _id: document._id?.toString?.() || document._id,

    /*
     * Convert nested MongoDB ObjectId values
     * to strings before sending to frontend.
     */
    reunion: document.reunion
      ? {
          ...document.reunion,

          eventId:
            document.reunion.eventId?.toString?.() || document.reunion.eventId,

          packageDatabaseId:
            document.reunion.packageDatabaseId?.toString?.() ||
            document.reunion.packageDatabaseId,
        }
      : document.reunion,
  };
};

/* ============================================================
   REGISTRATION ID
============================================================ */

const createRegistrationId = () => {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `SR-2027-${randomPart}`;
};

/* ============================================================
   AUTH HELPERS
============================================================ */

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

/* ============================================================
   EVENT HELPERS
============================================================ */

const isRegistrationDeadlinePassed = (event) => {
  if (!event?.registrationDeadline) {
    return false;
  }

  const deadline = new Date(event.registrationDeadline);

  if (Number.isNaN(deadline.getTime())) {
    return false;
  }

  return new Date() > deadline;
};

const isEventRegistrationOpen = (event) => {
  if (!event) {
    return false;
  }

  /*
   * Primary registration switch.
   */
  if (event.registrationOpen !== true) {
    return false;
  }

  /*
   * Nested registration setting.
   *
   * Missing registration.open is treated as open.
   */
  if (event.registration?.open === false) {
    return false;
  }

  if (isRegistrationDeadlinePassed(event)) {
    return false;
  }

  return true;
};

/* ============================================================
   GIFT PACKAGE FINDER
============================================================ */

const findGiftPackage = async (giftPackages, packageId) => {
  const normalizedPackageId = normalizeString(packageId);

  if (!normalizedPackageId) {
    return null;
  }

  const conditions = [
    {
      id: normalizedPackageId,
    },

    {
      packageId: normalizedPackageId,
    },
  ];

  /*
   * Support MongoDB ObjectId as package identifier.
   */
  if (isValidObjectId(normalizedPackageId)) {
    conditions.unshift({
      _id: new ObjectId(normalizedPackageId),
    });
  }

  return giftPackages.findOne({
    $or: conditions,

    active: {
      $ne: false,
    },
  });
};

/* ============================================================
   TEST ROUTE
============================================================ */

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Registrations route is working.",
    route: "/api/registrations",
    collection: "registrations",
  });
});

/* ============================================================
   GET /api/registrations
   LOAD ACTIVE REUNION EVENT
============================================================ */

router.get("/", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/reunion-events-collection-not-found",
        message: "reunionEvents collection is not available.",
      });
    }

    /*
     * Only return an event where registration is open.
     */
    const event = await reunionEvents.findOne(
      {
        registrationOpen: true,
        status: {
          $in: ["published", "active"],
        },
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
    console.error("GET /api/registrations error:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    return res.status(500).json({
      success: false,
      code: "registration/event-load-failed",
      message: "Failed to load reunion information.",
    });
  }
});

/* ============================================================
   POST /api/registrations/register

   CREATE REUNION REGISTRATION
============================================================ */

router.post("/register", verifyToken, async (req, res) => {
  try {
    await connectDB();

    const {
      users,
      studentProfiles,
      alumniProfiles,
      reunionEvents,
      registrations,
      giftPackages,
    } = getCollections();

    /* ------------------------------------------------------
         COLLECTION CHECK
      ------------------------------------------------------ */

    const requiredCollections = {
      users,
      studentProfiles,
      alumniProfiles,
      reunionEvents,
      registrations,
      giftPackages,
    };

    const missingCollection = Object.entries(requiredCollections).find(
      ([, collection]) => !collection,
    );

    if (missingCollection) {
      const [collectionName] = missingCollection;

      console.error(
        `Registration failed: missing collection "${collectionName}".`,
      );

      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: `Required database collection "${collectionName}" is not available.`,
      });
    }

    /* ------------------------------------------------------
         AUTHENTICATION
      ------------------------------------------------------ */

    const uid = getAuthenticatedUid(req);

    const authenticatedEmail = getAuthenticatedEmail(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated user UID could not be determined.",
      });
    }

    if (!authenticatedEmail) {
      return res.status(401).json({
        success: false,
        code: "auth/email-missing",
        message: "Authenticated user email could not be determined.",
      });
    }

    /* ------------------------------------------------------
         REQUEST BODY
      ------------------------------------------------------ */

    const body = req.body || {};

    const participant = body.participant || {};

    const schoolInfo = body.schoolInfo || {};

    const reunion = body.reunion || {};

    const consent = body.consent || {};

    /*
     * Production-safe logging.
     *
     * Never log Firebase token/password.
     */
    console.log("REGISTRATION REQUEST:", {
      uid,
      email: authenticatedEmail,
      eventId: reunion.eventId || body.eventId || null,
      packageId: reunion.packageId || body.packageId || null,
    });

    /* ------------------------------------------------------
         PARTICIPANT
      ------------------------------------------------------ */

    const name = normalizeString(
      participant.name ||
        body.name ||
        req.user?.name ||
        authenticatedEmail.split("@")[0],
    );

    const email = normalizeEmail(
      participant.email || body.email || authenticatedEmail,
    );

    const phone = normalizePhone(participant.phone || body.phone || "");

    /*
     * Frontend currently sends district/city
     * inside schoolInfo.
     *
     * Support both structures.
     */
    const district = normalizeString(
      participant.district || schoolInfo.district || body.district || "",
    );

    const city = normalizeString(
      participant.city || schoolInfo.city || body.city || "",
    );

    if (!name) {
      return res.status(400).json({
        success: false,
        code: "validation/name-required",
        message: "Name is required.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        code: "validation/email-required",
        message: "Email is required.",
      });
    }

    /*
     * Email must match Firebase authenticated email.
     */
    if (email !== authenticatedEmail) {
      return res.status(403).json({
        success: false,
        code: "auth/email-mismatch",
        message:
          "The submitted email does not match the authenticated account.",
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
        code: "validation/invalid-phone",
        message:
          "Please provide a valid Bangladesh mobile number, for example 01712345678.",
      });
    }

    /* ------------------------------------------------------
         SCHOOL INFORMATION
      ------------------------------------------------------ */

    /*
     * Support studentType from:
     *
     * schoolInfo.studentType
     * participant.studentType
     * body.studentType
     */
    const studentType = normalizeStudentType(
      schoolInfo.studentType ||
        participant.studentType ||
        body.studentType ||
        "",
    );

    const classLevel = normalizeClassLevel(
      schoolInfo.classLevel || body.classLevel || "",
    );

    const batchYear = normalizeBatchYear(
      schoolInfo.batchYear ?? body.batchYear ?? null,
    );

    const department = normalizeDepartment(
      schoolInfo.department || body.department || "",
    );

    if (!VALID_STUDENT_TYPES.has(studentType)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-student-type",
        message: "Student type must be current or alumni.",
      });
    }

    if (!VALID_CLASS_LEVELS.has(classLevel)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-class-level",
        message: "Class level must be between 6 and 10.",
      });
    }

    if (batchYear === null) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-batch-year",
        message: "A valid batch year is required.",
      });
    }

    if (batchYear < MIN_BATCH_YEAR || batchYear > MAX_BATCH_YEAR) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-batch-year",
        message: `Batch year must be between ${MIN_BATCH_YEAR} and ${MAX_BATCH_YEAR}.`,
      });
    }

    const requiresDepartment = classLevel === "9" || classLevel === "10";

    if (requiresDepartment && !VALID_DEPARTMENTS.has(department)) {
      return res.status(400).json({
        success: false,
        code: "validation/department-required",
        message: "Department is required for class 9 and 10.",
      });
    }

    /* ------------------------------------------------------
         REUNION INFORMATION
      ------------------------------------------------------ */

    const eventId = normalizeString(reunion.eventId || body.eventId || "");

    const packageId = normalizeString(
      reunion.packageId || body.packageId || "",
    );

    /*
     * Support:
     *
     * reunion.tShirt.size
     * reunion.tshirt.size
     * reunion.tShirtSize
     * reunion.tshirtSize
     * body.tShirtSize
     * body.tshirtSize
     */
    const tshirtSize = normalizeTshirtSize(
      reunion.tShirt?.size ||
        reunion.tshirt?.size ||
        reunion.tShirtSize ||
        reunion.tshirtSize ||
        body.tShirtSize ||
        body.tshirtSize ||
        "",
    );

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id-required",
        message: "Reunion event ID is required.",
      });
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
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

    /* ------------------------------------------------------
         CONSENT
      ------------------------------------------------------ */

    const agreedToRules =
      consent.agreedToRules === true || body.agreedToRules === true;

    if (!agreedToRules) {
      return res.status(400).json({
        success: false,
        code: "validation/consent-required",
        message: "You must agree to the reunion rules before registering.",
      });
    }

    /* ------------------------------------------------------
         EVENT
      ------------------------------------------------------ */

    const eventObjectId = toObjectId(eventId);

    if (!eventObjectId) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
        message: "Invalid reunion event ID.",
      });
    }

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

    /* ------------------------------------------------------
         REGISTRATION OPEN / CLOSED
      ------------------------------------------------------ */

    if (!isEventRegistrationOpen(event)) {
      if (isRegistrationDeadlinePassed(event)) {
        return res.status(403).json({
          success: false,
          code: "reunion/registration-deadline-passed",
          message: "The registration deadline has passed.",
        });
      }

      return res.status(403).json({
        success: false,
        code: "reunion/registration-closed",
        message: "Registration for this reunion is currently closed.",
      });
    }

    /* ------------------------------------------------------
         EVENT ELIGIBILITY
      ------------------------------------------------------ */

    const eligibleStudentTypes = Array.isArray(event.eligibility?.studentTypes)
      ? event.eligibility.studentTypes.map((item) =>
          String(item).trim().toLowerCase(),
        )
      : null;

    if (eligibleStudentTypes && !eligibleStudentTypes.includes(studentType)) {
      return res.status(400).json({
        success: false,
        code: "validation/student-type-not-eligible",
        message: "This student type is not eligible for this reunion.",
      });
    }

    const eligibleClassLevels = Array.isArray(event.eligibility?.classLevels)
      ? event.eligibility.classLevels.map(String)
      : null;

    if (eligibleClassLevels && !eligibleClassLevels.includes(classLevel)) {
      return res.status(400).json({
        success: false,
        code: "validation/class-not-eligible",
        message: "This class level is not eligible for this reunion.",
      });
    }

    if (requiresDepartment && Array.isArray(event.eligibility?.departments)) {
      const eligibleDepartments = event.eligibility.departments.map((item) =>
        String(item).trim().toLowerCase(),
      );

      if (!eligibleDepartments.includes(department)) {
        return res.status(400).json({
          success: false,
          code: "validation/department-not-eligible",
          message: "This department is not eligible for this reunion.",
        });
      }
    }

    /* ------------------------------------------------------
         CAPACITY
      ------------------------------------------------------ */

    if (
      event.capacity?.enabled === true &&
      Number.isFinite(Number(event.capacity.maximum))
    ) {
      const maximumCapacity = Number(event.capacity.maximum);

      const currentRegistrationCount = await registrations.countDocuments({
        "reunion.eventId": eventObjectId,

        status: {
          $ne: "cancelled",
        },
      });

      if (currentRegistrationCount >= maximumCapacity) {
        return res.status(409).json({
          success: false,
          code: "reunion/capacity-reached",
          message: "Registration capacity for this reunion has been reached.",
        });
      }
    }

    /* ------------------------------------------------------
         GIFT PACKAGE
      ------------------------------------------------------ */

    const giftPackage = await findGiftPackage(giftPackages, packageId);

    if (!giftPackage) {
      return res.status(404).json({
        success: false,
        code: "reunion/package-not-found",
        message: "The selected reunion gift package was not found.",
        packageId,
      });
    }

    if (giftPackage.active === false) {
      return res.status(400).json({
        success: false,
        code: "reunion/package-inactive",
        message: "The selected reunion package is currently unavailable.",
      });
    }

    /* ------------------------------------------------------
         PACKAGE EVENT COMPATIBILITY
      ------------------------------------------------------ */

    /*
     * General package:
     *
     * eventId: null
     *
     * is valid for the reunion.
     *
     * If package has an eventId, it must match
     * the selected event.
     */

    if (
      giftPackage.eventId !== null &&
      giftPackage.eventId !== undefined &&
      giftPackage.eventId !== ""
    ) {
      const packageEventId =
        giftPackage.eventId?.toString?.() || String(giftPackage.eventId);

      if (packageEventId !== eventId) {
        return res.status(400).json({
          success: false,
          code: "validation/package-event-mismatch",
          message:
            "The selected package does not belong to this reunion event.",
        });
      }
    }

    /* ------------------------------------------------------
         PACKAGE ELIGIBILITY
      ------------------------------------------------------ */

    if (Array.isArray(giftPackage.eligibility?.studentTypes)) {
      const packageStudentTypes = giftPackage.eligibility.studentTypes.map(
        (item) => String(item).trim().toLowerCase(),
      );

      if (!packageStudentTypes.includes(studentType)) {
        return res.status(400).json({
          success: false,
          code: "validation/package-not-eligible",
          message: "This package is not available for this student type.",
        });
      }
    }

    if (Array.isArray(giftPackage.eligibility?.classLevels)) {
      const packageClassLevels =
        giftPackage.eligibility.classLevels.map(String);

      if (!packageClassLevels.includes(classLevel)) {
        return res.status(400).json({
          success: false,
          code: "validation/package-not-eligible",
          message: "This package is not available for this class level.",
        });
      }
    }

    /* ------------------------------------------------------
         T-SHIRT
      ------------------------------------------------------ */

    const packageTshirt = giftPackage.tshirt || {};

    const tshirtRequired = packageTshirt.required === true;

    const packageTshirtSizes = Array.isArray(packageTshirt.sizes)
      ? packageTshirt.sizes.map(normalizeTshirtSize).filter(Boolean)
      : [];

    /*
     * If package requires T-shirt,
     * size must be supplied.
     */
    if (tshirtRequired && !tshirtSize) {
      return res.status(400).json({
        success: false,
        code: "validation/tshirt-size-required",
        message: "T-shirt size is required for this package.",
      });
    }

    /*
     * If a size is supplied,
     * validate it.
     */
    if (tshirtSize && !VALID_TSHIRT_SIZES.has(tshirtSize)) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-tshirt-size",
        message: "Please select a valid T-shirt size.",
      });
    }

    /*
     * If package defines available sizes,
     * selected size must be one of them.
     */
    if (
      packageTshirtSizes.length > 0 &&
      tshirtSize &&
      !packageTshirtSizes.includes(tshirtSize)
    ) {
      return res.status(400).json({
        success: false,
        code: "validation/tshirt-size-not-available",
        message: "The selected T-shirt size is not available.",
      });
    }

    /* ------------------------------------------------------
         DUPLICATE REGISTRATION
      ------------------------------------------------------ */

    const existingRegistration = await registrations.findOne({
      uid,

      "reunion.eventId": eventObjectId,
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        code: "registration/already-registered",
        message: "You are already registered for this reunion.",

        data: {
          registrationId: existingRegistration.registrationId || null,

          status: existingRegistration.status || null,
        },
      });
    }

    /* ------------------------------------------------------
         REGISTRATION DATA
      ------------------------------------------------------ */

    const registrationId = createRegistrationId();

    const now = new Date();

    const paymentRequired =
      event.paymentRequired === true ||
      event.payment?.required === true ||
      giftPackage.pricing?.required === true;

    const paymentStatus = paymentRequired ? "pending" : "not-required";

    const registrationDocument = {
      registrationId,

      uid,

      participant: {
        name,

        email: authenticatedEmail,

        phone,

        district: district || null,

        city: city || null,
      },

      schoolInfo: {
        studentType,

        classLevel,

        batchYear,

        department: requiresDepartment ? department : null,
      },

      reunion: {
        eventId: eventObjectId,

        eventTitle: event.title || event.shortTitle || null,

        packageId,

        packageDatabaseId: giftPackage._id ? giftPackage._id.toString() : null,

        packageName: giftPackage.name || giftPackage.title || null,

        tShirt: {
          size: tshirtSize || null,
        },
      },

      consent: {
        agreedToRules: true,

        agreedAt: now,
      },

      status: "confirmed",

      paymentStatus,

      qrCode: {
        enabled: event.qrCode?.enabled === true,

        purpose: event.qrCode?.purpose || "attendance",

        version: Number(event.qrCode?.version) || 1,

        token: crypto.randomBytes(24).toString("hex"),

        status: "active",

        generatedAt: now,
      },

      attendance: {
        status: "not-checked-in",

        checkedInAt: null,

        checkedInBy: null,
      },

      createdAt: now,

      updatedAt: now,
    };

    /* ------------------------------------------------------
         INSERT REGISTRATION
      ------------------------------------------------------ */

    let insertResult;

    try {
      insertResult = await registrations.insertOne(registrationDocument);
    } catch (error) {
      /*
       * MongoDB unique-index race condition.
       */
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          code: "registration/already-registered",
          message: "You are already registered for this reunion.",
        });
      }

      throw error;
    }

    /* ------------------------------------------------------
         UPDATE USERS
      ------------------------------------------------------ */

    try {
      await users.updateOne(
        {
          uid,
        },

        {
          $set: {
            uid,

            name,

            email: authenticatedEmail,

            phone,

            updatedAt: now,
          },

          $setOnInsert: {
            role: "student",

            status: "active",

            createdAt: now,
          },
        },

        {
          upsert: true,
        },
      );
    } catch (userError) {
      /*
       * Registration has already been successfully
       * inserted.
       *
       * Do not delete the registration automatically.
       */
      console.error("Registration created but user update failed:", {
        message: userError?.message,
        code: userError?.code,
      });
    }

    /* ------------------------------------------------------
         UPDATE STUDENT / ALUMNI PROFILE
      ------------------------------------------------------ */

    const profileCollection =
      studentType === "alumni" ? alumniProfiles : studentProfiles;

    try {
      await profileCollection.updateOne(
        {
          uid,
        },

        {
          $set: {
            uid,

            email: authenticatedEmail,

            name,

            phone,

            district: district || null,

            city: city || null,

            classLevel,

            batchYear,

            department: requiresDepartment ? department : null,

            studentType,

            updatedAt: now,
          },

          $setOnInsert: {
            createdAt: now,
          },
        },

        {
          upsert: true,
        },
      );
    } catch (profileError) {
      /*
       * Registration already exists.
       * Do not fail the registration response.
       */
      console.error("Registration created but profile update failed:", {
        message: profileError?.message,
        code: profileError?.code,
      });
    }

    /* ------------------------------------------------------
         SUCCESS
      ------------------------------------------------------ */

    return res.status(201).json({
      success: true,

      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        databaseId: insertResult.insertedId.toString(),

        status: registrationDocument.status,

        paymentStatus,

        qrCode: {
          enabled: registrationDocument.qrCode.enabled,

          purpose: registrationDocument.qrCode.purpose,

          status: registrationDocument.qrCode.status,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/registrations/register error:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    return res.status(500).json({
      success: false,
      code: "registration/server-error",
      message: "Failed to complete reunion registration.",
    });
  }
});

/* ============================================================
   GET /api/registrations/my-registration

   CURRENT AUTHENTICATED USER'S REGISTRATION
============================================================ */

router.get("/my-registration", verifyToken, async (req, res) => {
  try {
    await connectDB();

    const { registrations } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        code: "database/registrations-collection-not-found",
        message: "registrations collection is not available.",
      });
    }

    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated user UID could not be determined.",
      });
    }

    const registration = await registrations.findOne(
      {
        uid,

        status: {
          $ne: "cancelled",
        },
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
        message: "No reunion registration was found for your account.",
      });
    }

    return res.status(200).json({
      success: true,

      data: serializeDocument(registration),
    });
  } catch (error) {
    console.error("GET /api/registrations/my-registration error:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    return res.status(500).json({
      success: false,
      code: "registration/server-error",
      message: "Failed to load your registration.",
    });
  }
});

/* ============================================================
   GET /api/registrations/:registrationId

   CURRENT USER CAN ONLY SEE THEIR OWN REGISTRATION
============================================================ */

router.get("/:registrationId", verifyToken, async (req, res) => {
  try {
    await connectDB();

    const { registrations } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        code: "database/registrations-collection-not-found",
        message: "registrations collection is not available.",
      });
    }

    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/uid-missing",
        message: "Authenticated user UID could not be determined.",
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

    const registration = await registrations.findOne({
      registrationId,

      uid,
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        code: "registration/not-found",
        message: "Registration was not found.",
      });
    }

    return res.status(200).json({
      success: true,

      data: serializeDocument(registration),
    });
  } catch (error) {
    console.error("GET /api/registrations/:registrationId error:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    return res.status(500).json({
      success: false,
      code: "registration/server-error",
      message: "Failed to load registration.",
    });
  }
});

/* ============================================================
   EXPORT
============================================================ */

export default router;
