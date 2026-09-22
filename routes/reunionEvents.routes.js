import express from "express";
import crypto from "crypto";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

/* =========================================================
   CONSTANTS
========================================================= */

const VALID_STUDENT_TYPES = ["current", "alumni"];

const VALID_CLASS_LEVELS = ["6", "7", "8", "9", "10"];

const VALID_DEPARTMENTS = ["science", "commerce", "humanities", "vocational"];

const VALID_TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const BATCH_MIN = 1950;
const BATCH_MAX = 2100;

/* =========================================================
   HELPERS
========================================================= */

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

const normalizeEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizeObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectId) {
    return value;
  }

  if (!ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
};

const normalizeBoolean = (value) => {
  return value === true || value === "true";
};

const getUserUid = (req) => {
  return normalizeString(
    req.user?.uid ||
      req.user?.user_id ||
      req.user?.sub ||
      req.user?.firebaseUid,
  );
};

const getUserEmail = (req) => {
  return normalizeEmail(req.user?.email);
};

const createRegistrationId = () => {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `SR-2027-${randomPart}`;
};

const createQrToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const serializeValue = (value) => {
  if (value instanceof ObjectId) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeValue(item);
    }

    return result;
  }

  return value;
};

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  const serialized = serializeValue(document);

  if (serialized?._id) {
    serialized._id = String(serialized._id);
  }

  return serialized;
};

/* =========================================================
   SAFE QR CODE
   NEVER SEND qrCode.token TO FRONTEND
========================================================= */

const serializeSafeQrCode = (qrCode) => {
  if (!qrCode || typeof qrCode !== "object") {
    return null;
  }

  return {
    enabled: qrCode.enabled === true,
    purpose: normalizeString(qrCode.purpose),
    version: qrCode.version ?? 1,
    status: normalizeString(qrCode.status),
    generatedAt: qrCode.generatedAt
      ? new Date(qrCode.generatedAt).toISOString()
      : null,
  };
};

/* =========================================================
   SAFE REGISTRATION RESPONSE
========================================================= */

const serializeSafeRegistration = (registration) => {
  if (!registration) {
    return null;
  }

  const data = serializeDocument(registration);

  if (data.qrCode) {
    data.qrCode = serializeSafeQrCode(registration.qrCode);
  }

  return data;
};

/* =========================================================
   VALIDATION
========================================================= */

const validatePhone = (phone) => {
  return /^01[3-9]\d{8}$/.test(phone);
};

const validateBatchYear = (batchYear) => {
  const year = Number(batchYear);

  return Number.isInteger(year) && year >= BATCH_MIN && year <= BATCH_MAX;
};

const isSeniorClass = (classLevel) => {
  return classLevel === "9" || classLevel === "10";
};

/* =========================================================
   TEST ROUTE
========================================================= */

router.get("/test", async (req, res, next) => {
  try {
    await connectDB();

    res.status(200).json({
      success: true,
      message: "Registrations API is working.",
      route: "/api/registrations",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   GET ACTIVE REUNION EVENT
   GET /api/registrations
========================================================= */

router.get("/", async (req, res, next) => {
  try {
    await connectDB();

    const { reunionEvents, giftPackages } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
      });
    }

    const event = await reunionEvents.findOne(
      {
        status: "published",
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
        message: "No active reunion event is available.",
      });
    }

    let packages = [];

    if (giftPackages) {
      packages = await giftPackages
        .find({
          active: true,
        })
        .sort({
          createdAt: -1,
        })
        .toArray();
    }

    const serializedEvent = serializeDocument(event);

    res.status(200).json({
      success: true,
      data: serializedEvent,
      event: serializedEvent,
      packages: packages.map(serializeDocument),
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   GET MY EVENTS
   IMPORTANT:
   This MUST come before /:registrationId

   GET /api/registrations/my-events
========================================================= */

router.get("/my-events", verifyToken, async (req, res, next) => {
  try {
    await connectDB();

    const uid = getUserUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user ID was not found.",
      });
    }

    const { registrations, reunionEvents, giftPackages } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
      });
    }

    /* ---------------------------------------------
       1. Find all registrations of current user
    --------------------------------------------- */

    const registrationDocuments = await registrations
      .find({
        uid,
        status: {
          $ne: "cancelled",
        },
      })
      .sort({
        createdAt: -1,
      })
      .toArray();

    if (registrationDocuments.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    /* ---------------------------------------------
       2. Collect event IDs
    --------------------------------------------- */

    const eventIds = [
      ...new Set(
        registrationDocuments
          .map((registration) => {
            return registration?.reunion?.eventId;
          })
          .filter(Boolean)
          .map((eventId) => String(eventId)),
      ),
    ];

    const validEventIds = eventIds.map(normalizeObjectId).filter(Boolean);

    /* ---------------------------------------------
       3. Collect package IDs
    --------------------------------------------- */

    const packageIds = [
      ...new Set(
        registrationDocuments
          .map((registration) => {
            return registration?.reunion?.packageId;
          })
          .filter(Boolean)
          .map((packageId) => String(packageId)),
      ),
    ];

    const validPackageIds = packageIds.map(normalizeObjectId).filter(Boolean);

    /* ---------------------------------------------
       4. Fetch events
    --------------------------------------------- */

    let eventDocuments = [];

    if (reunionEvents && validEventIds.length > 0) {
      eventDocuments = await reunionEvents
        .find({
          _id: {
            $in: validEventIds,
          },
        })
        .toArray();
    }

    /* ---------------------------------------------
       5. Fetch packages
    --------------------------------------------- */

    let packageDocuments = [];

    if (giftPackages && validPackageIds.length > 0) {
      packageDocuments = await giftPackages
        .find({
          _id: {
            $in: validPackageIds,
          },
        })
        .toArray();
    }

    /* ---------------------------------------------
       6. Create lookup maps
    --------------------------------------------- */

    const eventMap = new Map(
      eventDocuments.map((event) => [String(event._id), event]),
    );

    const packageMap = new Map(
      packageDocuments.map((giftPackage) => [
        String(giftPackage._id),
        giftPackage,
      ]),
    );

    /* ---------------------------------------------
       7. Build response
    --------------------------------------------- */

    const data = registrationDocuments.map((registration) => {
      const eventId = registration?.reunion?.eventId
        ? String(registration.reunion.eventId)
        : "";

      const packageId = registration?.reunion?.packageId
        ? String(registration.reunion.packageId)
        : "";

      const event = eventMap.get(eventId) || null;

      const giftPackage = packageMap.get(packageId) || null;

      return {
        registration: serializeSafeRegistration(registration),

        event: serializeDocument(event),

        giftPackage: serializeDocument(giftPackage),
      };
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   GET MY REGISTRATION
   GET /api/registrations/my-registration
========================================================= */

router.get("/my-registration", verifyToken, async (req, res, next) => {
  try {
    await connectDB();

    const uid = getUserUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user ID was not found.",
      });
    }

    const { registrations, reunionEvents, giftPackages } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
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
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    let event = null;
    let giftPackage = null;

    /* ---------------------------------------------
         Event
      --------------------------------------------- */

    const eventId = normalizeObjectId(registration?.reunion?.eventId);

    if (reunionEvents && eventId) {
      event = await reunionEvents.findOne({
        _id: eventId,
      });
    }

    /* ---------------------------------------------
         Gift package
      --------------------------------------------- */

    const packageId = normalizeObjectId(registration?.reunion?.packageId);

    if (giftPackages && packageId) {
      giftPackage = await giftPackages.findOne({
        _id: packageId,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        registration: serializeSafeRegistration(registration),

        event: serializeDocument(event),

        giftPackage: serializeDocument(giftPackage),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   CREATE REGISTRATION
   POST /api/registrations/register
========================================================= */

router.post("/register", verifyToken, async (req, res, next) => {
  try {
    await connectDB();

    const uid = getUserUid(req);
    const authenticatedEmail = getUserEmail(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const {
      registrations,
      reunionEvents,
      giftPackages,
      users,
      studentProfiles,
      alumniProfiles,
    } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
      });
    }

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
      });
    }

    /* ---------------------------------------------
         Request data
      --------------------------------------------- */

    const participant = req.body?.participant || {};

    const schoolInfo = req.body?.schoolInfo || {};

    const reunion = req.body?.reunion || {};

    const consent = req.body?.consent || {};

    const name = normalizeString(participant.name);

    const email = normalizeEmail(participant.email);

    const phone = normalizeString(participant.phone);

    const district = normalizeString(participant.district);

    const city = normalizeString(participant.city);

    const studentType = normalizeString(schoolInfo.studentType).toLowerCase();

    const classLevel = normalizeString(schoolInfo.classLevel);

    const batchYear = Number(schoolInfo.batchYear);

    const department = normalizeString(schoolInfo.department).toLowerCase();

    const eventId = normalizeObjectId(reunion.eventId);

    const packageId = normalizeObjectId(reunion.packageId);

    const tShirtSize = normalizeString(
      reunion?.tShirt?.size || reunion?.tShirtSize,
    );

    const agreedToRules = normalizeBoolean(consent.agreedToRules);

    /* ---------------------------------------------
         Required fields
      --------------------------------------------- */

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    if (!authenticatedEmail) {
      return res.status(401).json({
        success: false,
        message: "Authenticated email was not found.",
      });
    }

    if (email !== authenticatedEmail) {
      return res.status(403).json({
        success: false,
        message: "Registration email must match your signed-in account.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!validatePhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid Bangladesh mobile number.",
      });
    }

    if (!district) {
      return res.status(400).json({
        success: false,
        message: "District is required.",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        message: "City is required.",
      });
    }

    /* ---------------------------------------------
         Student validation
      --------------------------------------------- */

    if (!VALID_STUDENT_TYPES.includes(studentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid student type.",
      });
    }

    if (!VALID_CLASS_LEVELS.includes(classLevel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid class level.",
      });
    }

    if (!validateBatchYear(batchYear)) {
      return res.status(400).json({
        success: false,
        message: `Batch year must be between ${BATCH_MIN} and ${BATCH_MAX}.`,
      });
    }

    if (isSeniorClass(classLevel)) {
      if (!VALID_DEPARTMENTS.includes(department)) {
        return res.status(400).json({
          success: false,
          message: "Department is required for class 9 and 10.",
        });
      }
    }

    /* ---------------------------------------------
         Event ID
      --------------------------------------------- */

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "A valid reunion event is required.",
      });
    }

    /* ---------------------------------------------
         Find event
      --------------------------------------------- */

    const event = await reunionEvents.findOne({
      _id: eventId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "The selected reunion event was not found.",
      });
    }

    if (event.status && event.status !== "published") {
      return res.status(403).json({
        success: false,
        message: "This reunion event is not currently published.",
      });
    }

    if (event.registrationOpen === false) {
      return res.status(403).json({
        success: false,
        message: "Registration for this reunion is currently closed.",
      });
    }

    /* ---------------------------------------------
         Registration deadline
      --------------------------------------------- */

    if (event.registrationDeadline) {
      const deadline = new Date(event.registrationDeadline);

      if (!Number.isNaN(deadline.getTime()) && new Date() > deadline) {
        return res.status(403).json({
          success: false,
          message: "The registration deadline has passed.",
        });
      }
    }

    /* ---------------------------------------------
         Eligibility
      --------------------------------------------- */

    const eligibleStudentTypes = Array.isArray(event?.eligibility?.studentTypes)
      ? event.eligibility.studentTypes
      : VALID_STUDENT_TYPES;

    if (!eligibleStudentTypes.includes(studentType)) {
      return res.status(400).json({
        success: false,
        message: "You are not eligible for this event.",
      });
    }

    const eligibleClasses = Array.isArray(event?.eligibility?.classLevels)
      ? event.eligibility.classLevels
      : VALID_CLASS_LEVELS;

    if (!eligibleClasses.includes(classLevel)) {
      return res.status(400).json({
        success: false,
        message: "Your class level is not eligible for this event.",
      });
    }

    /* ---------------------------------------------
         Gift package
      --------------------------------------------- */

    let giftPackage = null;

    if (packageId) {
      if (!giftPackages) {
        return res.status(500).json({
          success: false,
          message: "Gift packages collection is not available.",
        });
      }

      giftPackage = await giftPackages.findOne({
        _id: packageId,
        active: true,
      });

      if (!giftPackage) {
        return res.status(400).json({
          success: false,
          message: "Selected gift package was not found or is inactive.",
        });
      }
    }

    /* ---------------------------------------------
         T-shirt validation
      --------------------------------------------- */

    const tshirtRequired =
      giftPackage?.tshirt?.required === true ||
      giftPackage?.tShirt?.required === true ||
      giftPackage?.items?.some(
        (item) =>
          item &&
          typeof item === "object" &&
          item.included !== false &&
          (item.requiresSize === true || item.id === "tshirt"),
      );

    if (tshirtRequired && !VALID_TSHIRT_SIZES.includes(tShirtSize)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid T-shirt size.",
      });
    }

    if (tShirtSize && !VALID_TSHIRT_SIZES.includes(tShirtSize)) {
      return res.status(400).json({
        success: false,
        message: "Invalid T-shirt size.",
      });
    }

    /* ---------------------------------------------
         Consent
      --------------------------------------------- */

    if (!agreedToRules) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the reunion rules.",
      });
    }

    /* ---------------------------------------------
         Capacity
      --------------------------------------------- */

    if (event?.capacity?.enabled === true) {
      const maximum = Number(event.capacity.maximum);

      if (Number.isFinite(maximum) && maximum > 0) {
        const confirmedCount = await registrations.countDocuments({
          "reunion.eventId": eventId,
          status: {
            $ne: "cancelled",
          },
        });

        if (confirmedCount >= maximum) {
          return res.status(409).json({
            success: false,
            message: "Registration capacity for this event has been reached.",
          });
        }
      }
    }

    /* ---------------------------------------------
         Duplicate registration check
      --------------------------------------------- */

    const existingRegistration = await registrations.findOne({
      uid,
      "reunion.eventId": eventId,
      status: {
        $ne: "cancelled",
      },
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        message: "You have already registered for this reunion event.",
        registrationId: existingRegistration.registrationId,
      });
    }

    /* ---------------------------------------------
         Registration ID
      --------------------------------------------- */

    let registrationId = createRegistrationId();

    let registrationIdExists = await registrations.findOne({
      registrationId,
    });

    while (registrationIdExists) {
      registrationId = createRegistrationId();

      registrationIdExists = await registrations.findOne({
        registrationId,
      });
    }

    /* ---------------------------------------------
         QR code
         Token stays in database only.
      --------------------------------------------- */

    const qrCode = {
      enabled: event?.qrCode?.enabled !== false,

      purpose: normalizeString(event?.qrCode?.purpose) || "attendance",

      version: Number(event?.qrCode?.version) || 1,

      token: createQrToken(),

      status: "active",

      generatedAt: new Date(),
    };

    /* ---------------------------------------------
         Registration document
      --------------------------------------------- */

    const now = new Date();

    const registrationDocument = {
      registrationId,

      uid,

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

        ...(isSeniorClass(classLevel)
          ? {
              department,
            }
          : {
              department: null,
            }),
      },

      reunion: {
        eventId: event._id,

        eventTitle: normalizeString(event.title),

        packageId: giftPackage?._id || null,

        packageDatabaseId: giftPackage?._id || null,

        packageName:
          normalizeString(giftPackage?.name || giftPackage?.title) || null,

        ...(tShirtSize
          ? {
              tShirt: {
                size: tShirtSize,
              },
            }
          : {}),
      },

      consent: {
        agreedToRules: true,
        agreedAt: now,
      },

      status: "confirmed",

      paymentStatus:
        event?.paymentRequired === true ? "pending" : "not-required",

      qrCode,

      attendance: {
        status: "not-checked-in",
        checkedInAt: null,
        checkedInBy: null,
      },

      createdAt: now,
      updatedAt: now,
    };

    /* ---------------------------------------------
         Insert registration
      --------------------------------------------- */

    let insertResult;

    try {
      insertResult = await registrations.insertOne(registrationDocument);
    } catch (error) {
      /* -------------------------------------------
           Unique index race-condition protection
        ------------------------------------------- */

      if (error?.code === 11000) {
        const duplicate = await registrations.findOne({
          uid,
          "reunion.eventId": event._id,
          status: {
            $ne: "cancelled",
          },
        });

        return res.status(409).json({
          success: false,
          message: "You have already registered for this reunion event.",
          registrationId: duplicate?.registrationId || null,
        });
      }

      throw error;
    }

    /* ---------------------------------------------
         Update users collection
      --------------------------------------------- */

    if (users) {
      await users.updateOne(
        {
          uid,
        },
        {
          $set: {
            name,
            email,
            phone,
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
    }

    /* ---------------------------------------------
         Save student/alumni profile
      --------------------------------------------- */

    const profileCollection =
      studentType === "alumni" ? alumniProfiles : studentProfiles;

    if (profileCollection) {
      await profileCollection.updateOne(
        {
          uid,
        },
        {
          $set: {
            uid,
            name,
            email,
            phone,
            district,
            city,
            studentType,
            classLevel,
            batchYear,

            ...(isSeniorClass(classLevel)
              ? {
                  department,
                }
              : {
                  department: null,
                }),

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
    }

    /* ---------------------------------------------
         Response
      --------------------------------------------- */

    const safeRegistration = serializeSafeRegistration(registrationDocument);

    return res.status(201).json({
      success: true,
      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        databaseId: insertResult.insertedId.toString(),

        status: registrationDocument.status,

        paymentStatus: registrationDocument.paymentStatus,

        registration: safeRegistration,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   GET REGISTRATION BY REGISTRATION ID

   IMPORTANT:
   This route must remain AFTER:
   /my-events
   /my-registration

   GET /api/registrations/:registrationId
========================================================= */

router.get("/:registrationId", verifyToken, async (req, res, next) => {
  try {
    await connectDB();

    const uid = getUserUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const registrationId = normalizeString(req.params.registrationId);

    if (!registrationId) {
      return res.status(400).json({
        success: false,
        message: "Registration ID is required.",
      });
    }

    const { registrations, reunionEvents, giftPackages } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
      });
    }

    const registration = await registrations.findOne({
      registrationId,
      uid,
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration was not found.",
      });
    }

    let event = null;
    let giftPackage = null;

    /* ---------------------------------------------
         Event
      --------------------------------------------- */

    const eventId = normalizeObjectId(registration?.reunion?.eventId);

    if (reunionEvents && eventId) {
      event = await reunionEvents.findOne({
        _id: eventId,
      });
    }

    /* ---------------------------------------------
         Package
      --------------------------------------------- */

    const packageId = normalizeObjectId(registration?.reunion?.packageId);

    if (giftPackages && packageId) {
      giftPackage = await giftPackages.findOne({
        _id: packageId,
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        registration: serializeSafeRegistration(registration),

        event: serializeDocument(event),

        giftPackage: serializeDocument(giftPackage),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;
