import express from "express";
import crypto from "crypto";
import { ObjectId } from "mongodb";

import { getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

/* =========================================================
   CONSTANTS
========================================================= */

const VALID_CLASS_LEVELS = ["6", "7", "8", "9", "10"];

const VALID_STUDENT_TYPES = ["current", "alumni"];

const VALID_DEPARTMENTS = ["science", "commerce", "humanities", "vocational"];

const VALID_TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const SENIOR_CLASS_LEVELS = ["9", "10"];

const PHONE_REGEX = /^01[3-9]\d{8}$/;

const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEAR = 2100;

const DEFAULT_EVENT_TITLE = "Grand School Reunion 2027";
const DEFAULT_PACKAGE_ID = "general";
const DEFAULT_PACKAGE_NAME = "General Reunion Package";

/* =========================================================
   BASIC HELPERS
========================================================= */

const cleanString = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const normalizeEmail = (email) => {
  return cleanString(email).toLowerCase();
};

const normalizeStudentType = (value) => {
  const normalized = cleanString(value).toLowerCase();

  return normalized || null;
};

const normalizeDepartment = (value) => {
  const normalized = cleanString(value).toLowerCase();

  return normalized || null;
};

const normalizeClassLevel = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
};

const normalizeTshirtSize = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();

  if (normalized === "XXL") {
    return "2XL";
  }

  return normalized;
};

const isSeniorClass = (classLevel) => {
  return SENIOR_CLASS_LEVELS.includes(String(classLevel));
};

const isValidObjectId = (value) => {
  if (!value) {
    return false;
  }

  return ObjectId.isValid(String(value));
};

const toObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectId) {
    return value;
  }

  const stringValue = String(value);

  if (!ObjectId.isValid(stringValue)) {
    return null;
  }

  return new ObjectId(stringValue);
};

/* =========================================================
   ID / QR TOKEN HELPERS
========================================================= */

const createRegistrationId = () => {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `SR-2027-${randomPart}`;
};

const createQrToken = () => {
  return crypto.randomBytes(24).toString("hex");
};

/* =========================================================
   SERIALIZATION
========================================================= */

/*
 * Never expose qrCode.token to frontend.
 */
const serializeQrCode = (qrCode) => {
  if (!qrCode || typeof qrCode !== "object") {
    return null;
  }

  return {
    enabled: qrCode.enabled === true,
    purpose: qrCode.purpose || "attendance",
    version: Number(qrCode.version) || 1,
    status: qrCode.status || "active",
    generatedAt: qrCode.generatedAt || null,
  };
};

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  const serialized = {
    ...document,

    _id: document._id?.toString?.() || document._id || null,
  };

  if (document.reunion) {
    serialized.reunion = {
      ...document.reunion,

      eventId:
        document.reunion.eventId?.toString?.() ||
        document.reunion.eventId ||
        null,

      packageDatabaseId:
        document.reunion.packageDatabaseId?.toString?.() ||
        document.reunion.packageDatabaseId ||
        null,
    };
  }

  if (document.qrCode) {
    serialized.qrCode = serializeQrCode(document.qrCode);
  }

  if (document.attendance) {
    serialized.attendance = {
      ...document.attendance,
    };
  }

  return serialized;
};

const serializeEvent = (event) => {
  if (!event) {
    return null;
  }

  return {
    ...event,

    _id: event._id?.toString?.() || event._id || null,
  };
};

const serializeGiftPackage = (giftPackage) => {
  if (!giftPackage) {
    return null;
  }

  return {
    ...giftPackage,

    _id: giftPackage._id?.toString?.() || giftPackage._id || null,

    eventId: giftPackage.eventId?.toString?.() || giftPackage.eventId || null,
  };
};

/* =========================================================
   EVENT HELPERS
========================================================= */

const findActiveReunionEvent = async (reunionEvents) => {
  if (!reunionEvents) {
    return null;
  }

  return reunionEvents.findOne(
    {
      status: {
        $in: ["published", "active"],
      },

      registrationOpen: true,
    },
    {
      sort: {
        eventDate: 1,
        createdAt: -1,
      },
    },
  );
};

const isRegistrationOpen = (event) => {
  if (!event) {
    return false;
  }

  if (event.registrationOpen === false) {
    return false;
  }

  if (event.registration?.open === false) {
    return false;
  }

  if (
    event.registrationDeadline &&
    new Date(event.registrationDeadline).getTime() < Date.now()
  ) {
    return false;
  }

  return true;
};

/* =========================================================
   GIFT PACKAGE HELPERS
========================================================= */

const findGiftPackage = async (giftPackages, packageId, eventId = null) => {
  if (!giftPackages || !packageId) {
    return null;
  }

  const normalizedPackageId = cleanString(packageId);

  if (!normalizedPackageId) {
    return null;
  }

  const filters = [
    {
      packageId: normalizedPackageId,
      active: {
        $ne: false,
      },
    },

    {
      id: normalizedPackageId,
      active: {
        $ne: false,
      },
    },
  ];

  const objectId = toObjectId(normalizedPackageId);

  if (objectId) {
    filters.push({
      _id: objectId,
      active: {
        $ne: false,
      },
    });
  }

  let giftPackage = await giftPackages.findOne({
    $or: filters,
  });

  if (!giftPackage) {
    return null;
  }

  /*
   * eventId null / missing means this is a general package.
   */
  if (
    giftPackage.eventId !== null &&
    giftPackage.eventId !== undefined &&
    giftPackage.eventId !== ""
  ) {
    const packageEventId =
      giftPackage.eventId?.toString?.() || String(giftPackage.eventId);

    const currentEventId = eventId?.toString?.() || String(eventId || "");

    if (packageEventId !== currentEventId) {
      return null;
    }
  }

  return giftPackage;
};

/* =========================================================
   TEST ROUTE
   GET /api/registrations/test
========================================================= */

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Registrations route is working.",
  });
});

/* =========================================================
   GET ACTIVE REUNION EVENT
   GET /api/registrations

   Public route
========================================================= */

router.get("/", async (req, res) => {
  try {
    const { reunionEvents, giftPackages } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/collection-not-found",
      });
    }

    const event = await findActiveReunionEvent(reunionEvents);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "No active reunion event is available.",
        code: "event/not-found",
      });
    }

    let packageOptions = [];

    if (giftPackages) {
      packageOptions = await giftPackages
        .find({
          active: {
            $ne: false,
          },

          $or: [
            {
              eventId: null,
            },

            {
              eventId: {
                $exists: false,
              },
            },

            {
              eventId: event._id,
            },

            {
              eventId: String(event._id),
            },
          ],
        })
        .sort({
          createdAt: 1,
        })
        .toArray();
    }

    return res.status(200).json({
      success: true,

      data: {
        ...serializeEvent(event),

        packages: packageOptions.map(serializeGiftPackage),
      },
    });
  } catch (error) {
    console.error("GET /api/registrations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reunion event.",
      code: "registrations/event-load-failed",
    });
  }
});

/* =========================================================
   CREATE REGISTRATION
   POST /api/registrations/register

   Authentication:
   Required
========================================================= */

router.post("/register", verifyToken, async (req, res) => {
  try {
    const {
      users,
      studentProfiles,
      alumniProfiles,
      reunionEvents,
      registrations,
      giftPackages,
    } = getCollections();

    /* -----------------------------------------------------
         COLLECTION VALIDATION
      ----------------------------------------------------- */

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
        code: "database/collection-not-found",
      });
    }

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/collection-not-found",
      });
    }

    /* -----------------------------------------------------
         AUTHENTICATION
      ----------------------------------------------------- */

    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        code: "auth/unauthorized",
      });
    }

    const uid = req.user.uid;

    const authenticatedEmail = normalizeEmail(req.user.email);

    if (!authenticatedEmail) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Firebase account does not have an email.",
        code: "auth/email-missing",
      });
    }

    /* -----------------------------------------------------
         REQUEST BODY
      ----------------------------------------------------- */

    const body = req.body || {};

    const participant =
      body.participant && typeof body.participant === "object"
        ? body.participant
        : {};

    const schoolInfo =
      body.schoolInfo && typeof body.schoolInfo === "object"
        ? body.schoolInfo
        : {};

    const reunion =
      body.reunion && typeof body.reunion === "object" ? body.reunion : {};

    const consent =
      body.consent && typeof body.consent === "object" ? body.consent : {};

    /* -----------------------------------------------------
         PARTICIPANT
      ----------------------------------------------------- */

    const name = cleanString(participant.name);

    const email = normalizeEmail(participant.email);

    const phone = cleanString(participant.phone);

    const district =
      cleanString(schoolInfo.district) ||
      cleanString(participant.district) ||
      cleanString(body.district);

    const city =
      cleanString(schoolInfo.city) ||
      cleanString(participant.city) ||
      cleanString(body.city);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
        code: "validation/name-required",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
        code: "validation/email-required",
      });
    }

    if (email !== authenticatedEmail) {
      return res.status(403).json({
        success: false,
        message: "Registration email must match your logged-in account.",
        code: "auth/email-mismatch",
      });
    }

    /* -----------------------------------------------------
         PHONE
      ----------------------------------------------------- */

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
        code: "validation/phone-required",
      });
    }

    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid Bangladesh mobile number.",
        code: "validation/invalid-phone",
      });
    }

    /* -----------------------------------------------------
         LOCATION
      ----------------------------------------------------- */

    if (!district) {
      return res.status(400).json({
        success: false,
        message: "District is required.",
        code: "validation/district-required",
      });
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        message: "City is required.",
        code: "validation/city-required",
      });
    }

    /* -----------------------------------------------------
         SCHOOL INFORMATION
      ----------------------------------------------------- */

    const studentType = normalizeStudentType(
      schoolInfo.studentType || participant.studentType || body.studentType,
    );

    const classLevel = normalizeClassLevel(
      schoolInfo.classLevel || participant.classLevel || body.classLevel,
    );

    const batchYearRaw =
      schoolInfo.batchYear ?? participant.batchYear ?? body.batchYear;

    const department = normalizeDepartment(
      schoolInfo.department || participant.department || body.department,
    );

    if (!studentType) {
      return res.status(400).json({
        success: false,
        message: "Student type is required.",
        code: "validation/student-type-required",
      });
    }

    if (!VALID_STUDENT_TYPES.includes(studentType)) {
      return res.status(400).json({
        success: false,
        message: "Student type must be current or alumni.",
        code: "validation/invalid-student-type",
      });
    }

    if (!classLevel) {
      return res.status(400).json({
        success: false,
        message: "Class level is required.",
        code: "validation/class-required",
      });
    }

    if (!VALID_CLASS_LEVELS.includes(classLevel)) {
      return res.status(400).json({
        success: false,
        message: "Class level must be between 6 and 10.",
        code: "validation/invalid-class",
      });
    }

    /* -----------------------------------------------------
         BATCH YEAR
      ----------------------------------------------------- */

    const batchYear = Number(batchYearRaw);

    if (
      !Number.isInteger(batchYear) ||
      batchYear < MIN_BATCH_YEAR ||
      batchYear > MAX_BATCH_YEAR
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid batch year.",
        code: "validation/invalid-batch-year",
      });
    }

    /* -----------------------------------------------------
         DEPARTMENT
      ----------------------------------------------------- */

    if (isSeniorClass(classLevel)) {
      if (!department) {
        return res.status(400).json({
          success: false,
          message: "Department is required for Class 9 and 10.",
          code: "validation/department-required",
        });
      }

      if (!VALID_DEPARTMENTS.includes(department)) {
        return res.status(400).json({
          success: false,
          message: "Invalid department selected.",
          code: "validation/invalid-department",
        });
      }
    }

    /*
     * Classes 6, 7 and 8 do not use departments.
     */
    const finalDepartment = isSeniorClass(classLevel) ? department : null;

    /* -----------------------------------------------------
         EVENT
      ----------------------------------------------------- */

    const requestedEventId = reunion.eventId || body.eventId || null;

    let event = null;

    if (requestedEventId) {
      const eventObjectId = toObjectId(requestedEventId);

      if (!eventObjectId) {
        return res.status(400).json({
          success: false,
          message: "Invalid reunion event ID.",
          code: "validation/invalid-event-id",
        });
      }

      event = await reunionEvents.findOne({
        _id: eventObjectId,
      });
    } else {
      event = await findActiveReunionEvent(reunionEvents);
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Reunion event was not found.",
        code: "event/not-found",
      });
    }

    /* -----------------------------------------------------
         EVENT REGISTRATION STATUS
      ----------------------------------------------------- */

    if (!isRegistrationOpen(event)) {
      return res.status(403).json({
        success: false,
        message: "Registration for this reunion is currently closed.",
        code: "registration/closed",
      });
    }

    /* -----------------------------------------------------
         EVENT ELIGIBILITY
      ----------------------------------------------------- */

    const eligibleStudentTypes = event.eligibility?.studentTypes;

    const eligibleClassLevels = event.eligibility?.classLevels;

    const eligibleDepartments = event.eligibility?.departments;

    if (
      Array.isArray(eligibleStudentTypes) &&
      eligibleStudentTypes.length > 0 &&
      !eligibleStudentTypes.includes(studentType)
    ) {
      return res.status(400).json({
        success: false,
        message: "You are not eligible for this reunion event.",
        code: "registration/student-type-not-eligible",
      });
    }

    if (
      Array.isArray(eligibleClassLevels) &&
      eligibleClassLevels.length > 0 &&
      !eligibleClassLevels.includes(classLevel)
    ) {
      return res.status(400).json({
        success: false,
        message: "Your class level is not eligible for this reunion event.",
        code: "registration/class-not-eligible",
      });
    }

    if (
      isSeniorClass(classLevel) &&
      Array.isArray(eligibleDepartments) &&
      eligibleDepartments.length > 0 &&
      !eligibleDepartments.includes(finalDepartment)
    ) {
      return res.status(400).json({
        success: false,
        message: "Your department is not eligible for this reunion event.",
        code: "registration/department-not-eligible",
      });
    }

    /* -----------------------------------------------------
         CAPACITY
      ----------------------------------------------------- */

    if (
      event.capacity?.enabled === true &&
      Number.isFinite(Number(event.capacity.maximum))
    ) {
      const maximum = Number(event.capacity.maximum);

      const currentCount = await registrations.countDocuments({
        $or: [
          {
            "reunion.eventId": event._id,
          },

          {
            "reunion.eventId": String(event._id),
          },
        ],

        status: {
          $ne: "cancelled",
        },
      });

      if (currentCount >= maximum) {
        return res.status(403).json({
          success: false,
          message: "Registration capacity for this reunion has been reached.",
          code: "registration/capacity-reached",
        });
      }
    }

    /* -----------------------------------------------------
         GIFT PACKAGE
      ----------------------------------------------------- */

    const requestedPackageId =
      reunion.packageId || body.packageId || DEFAULT_PACKAGE_ID;

    const giftPackage = await findGiftPackage(
      giftPackages,
      requestedPackageId,
      event._id,
    );

    if (!giftPackage) {
      return res.status(400).json({
        success: false,
        message: "Selected reunion gift package was not found.",
        code: "registration/package-not-found",
      });
    }

    /* -----------------------------------------------------
         T-SHIRT
      ----------------------------------------------------- */

    const requestedTshirtSize =
      reunion.tShirt?.size ||
      reunion.tshirt?.size ||
      body.tshirtSize ||
      body.tShirtSize ||
      null;

    const normalizedTshirtSize = normalizeTshirtSize(requestedTshirtSize);

    const packageTshirt = giftPackage.tshirt || giftPackage.tShirt || {};

    const tshirtRequired = packageTshirt.required === true;

    const tshirtIncluded = packageTshirt.included === true;

    if ((tshirtRequired || tshirtIncluded) && !normalizedTshirtSize) {
      return res.status(400).json({
        success: false,
        message: "T-shirt size is required.",
        code: "validation/tshirt-size-required",
      });
    }

    if (
      normalizedTshirtSize &&
      !VALID_TSHIRT_SIZES.includes(normalizedTshirtSize)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid T-shirt size.",
        code: "validation/invalid-tshirt-size",
      });
    }

    /* -----------------------------------------------------
         AVAILABLE T-SHIRT SIZES
      ----------------------------------------------------- */

    const availableTshirtSizes =
      packageTshirt.availableSizes || packageTshirt.sizes || null;

    if (
      normalizedTshirtSize &&
      Array.isArray(availableTshirtSizes) &&
      availableTshirtSizes.length > 0
    ) {
      const normalizedAvailableSizes =
        availableTshirtSizes.map(normalizeTshirtSize);

      if (!normalizedAvailableSizes.includes(normalizedTshirtSize)) {
        return res.status(400).json({
          success: false,
          message: `T-shirt size ${normalizedTshirtSize} is not available in this package.`,
          code: "registration/tshirt-size-unavailable",
        });
      }
    }

    /* -----------------------------------------------------
         CONSENT
      ----------------------------------------------------- */

    const agreedToRules =
      consent.agreedToRules === true || body.agreeToRules === true;

    const requiresConsent = event.registration?.requiresConsent !== false;

    if (requiresConsent && !agreedToRules) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the reunion rules before registering.",
        code: "validation/consent-required",
      });
    }

    /* -----------------------------------------------------
         DUPLICATE REGISTRATION
      ----------------------------------------------------- */

    const existingRegistration = await registrations.findOne({
      uid,

      $or: [
        {
          "reunion.eventId": event._id,
        },

        {
          "reunion.eventId": String(event._id),
        },
      ],

      status: {
        $ne: "cancelled",
      },
    });

    if (existingRegistration) {
      return res.status(409).json({
        success: false,
        message: "You are already registered for this reunion.",
        code: "registration/already-registered",

        data: {
          registrationId: existingRegistration.registrationId,

          status: existingRegistration.status,
        },
      });
    }

    /* -----------------------------------------------------
         REGISTRATION ID
      ----------------------------------------------------- */

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

    /* -----------------------------------------------------
         PAYMENT
      ----------------------------------------------------- */

    const paymentRequired =
      event.paymentRequired === true ||
      event.payment?.required === true ||
      giftPackage.pricing?.required === true;

    const paymentStatus = paymentRequired ? "pending" : "not-required";

    /* -----------------------------------------------------
         TIMESTAMP
      ----------------------------------------------------- */

    const now = new Date();

    /* -----------------------------------------------------
         QR CODE
      ----------------------------------------------------- */

    const qrEnabled = event.qrCode?.enabled !== false;

    const qrToken = qrEnabled ? createQrToken() : null;

    /* -----------------------------------------------------
         REGISTRATION DOCUMENT
      ----------------------------------------------------- */

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
        department: finalDepartment,
      },

      reunion: {
        eventId: event._id,

        eventTitle: event.title || DEFAULT_EVENT_TITLE,

        packageId:
          giftPackage.packageId || giftPackage.id || requestedPackageId,

        packageDatabaseId: giftPackage._id,

        packageName:
          giftPackage.name || giftPackage.title || DEFAULT_PACKAGE_NAME,

        tShirt: {
          size: normalizedTshirtSize,
        },
      },

      consent: {
        agreedToRules,

        agreedAt: agreedToRules
          ? consent.agreedAt
            ? new Date(consent.agreedAt)
            : now
          : null,
      },

      status: paymentRequired ? "pending-payment" : "confirmed",

      paymentStatus,

      qrCode: {
        enabled: qrEnabled,

        purpose: event.qrCode?.purpose || "attendance",

        version: Number(event.qrCode?.version) || 1,

        token: qrToken,

        status: qrEnabled ? "active" : "disabled",

        generatedAt: qrEnabled ? now : null,
      },

      attendance: {
        status: "not-checked-in",
        checkedInAt: null,
        checkedInBy: null,
      },

      createdAt: now,
      updatedAt: now,
    };

    /* -----------------------------------------------------
         INSERT REGISTRATION
      ----------------------------------------------------- */

    const insertResult = await registrations.insertOne(registrationDocument);

    /* -----------------------------------------------------
         UPDATE USERS COLLECTION
      ----------------------------------------------------- */

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
            provider:
              req.user?.firebase?.sign_in_provider === "google.com"
                ? "google"
                : "password",
            emailVerified: req.user?.email_verified === true,
            createdAt: now,
          },
        },

        {
          upsert: true,
        },
      );
    }

    /* -----------------------------------------------------
         PROFILE UPSERT
      ----------------------------------------------------- */

    const profileCollection =
      studentType === "current" ? studentProfiles : alumniProfiles;

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
            department: finalDepartment,
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

    /* -----------------------------------------------------
         SUCCESS RESPONSE
      ----------------------------------------------------- */

    console.log("Registration created successfully:", registrationId);

    return res.status(201).json({
      success: true,

      message: "Reunion registration completed successfully.",

      data: {
        registrationId,

        databaseId: insertResult.insertedId.toString(),

        status: registrationDocument.status,

        paymentStatus,

        eventId: event._id.toString(),

        packageId: registrationDocument.reunion.packageId,

        qrCode: {
          enabled: registrationDocument.qrCode.enabled,

          status: registrationDocument.qrCode.status,

          purpose: registrationDocument.qrCode.purpose,

          version: registrationDocument.qrCode.version,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/registrations/register error:", error);

    /* -----------------------------------------------------
         DUPLICATE KEY
      ----------------------------------------------------- */

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A registration with this information already exists.",
        code: "registration/duplicate",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create reunion registration.",
      code: "registration/create-failed",
    });
  }
});

/* =========================================================
   GET MY REGISTRATION
   GET /api/registrations/my-registration

   Authentication:
   Required
========================================================= */

router.get("/my-registration", verifyToken, async (req, res) => {
  try {
    const { registrations, reunionEvents, giftPackages } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
        code: "database/collection-not-found",
      });
    }

    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        code: "auth/unauthorized",
      });
    }

    const uid = req.user.uid;

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
        message: "No reunion registration found for your account.",
        code: "registration/not-found",
      });
    }

    /* -----------------------------------------------------
         EVENT
      ----------------------------------------------------- */

    let event = null;

    if (reunionEvents && registration.reunion?.eventId) {
      const eventId = toObjectId(registration.reunion.eventId);

      if (eventId) {
        event = await reunionEvents.findOne({
          _id: eventId,
        });
      }
    }

    /* -----------------------------------------------------
         GIFT PACKAGE
      ----------------------------------------------------- */

    let giftPackage = null;

    if (giftPackages && registration.reunion?.packageId) {
      giftPackage = await findGiftPackage(
        giftPackages,
        registration.reunion.packageId,
        registration.reunion.eventId,
      );
    }

    return res.status(200).json({
      success: true,

      data: serializeDocument(registration),

      event: serializeEvent(event),

      giftPackage: serializeGiftPackage(giftPackage),
    });
  } catch (error) {
    console.error("GET /api/registrations/my-registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your reunion registration.",
      code: "registration/my-registration-failed",
    });
  }
});

/* =========================================================
   GET SINGLE REGISTRATION
   GET /api/registrations/:registrationId

   Authentication:
   Required

   Security:
   User can only access their own registration.
========================================================= */

router.get("/:registrationId", verifyToken, async (req, res) => {
  try {
    const { registrations, reunionEvents, giftPackages } = getCollections();

    if (!registrations) {
      return res.status(500).json({
        success: false,
        message: "Registrations collection is not available.",
        code: "database/collection-not-found",
      });
    }

    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        code: "auth/unauthorized",
      });
    }

    const registrationId = cleanString(req.params.registrationId);

    if (!registrationId) {
      return res.status(400).json({
        success: false,
        message: "Registration ID is required.",
        code: "validation/registration-id-required",
      });
    }

    const registration = await registrations.findOne({
      registrationId,

      uid: req.user.uid,

      status: {
        $ne: "cancelled",
      },
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration not found.",
        code: "registration/not-found",
      });
    }

    /* -----------------------------------------------------
         EVENT
      ----------------------------------------------------- */

    let event = null;

    if (reunionEvents && registration.reunion?.eventId) {
      const eventId = toObjectId(registration.reunion.eventId);

      if (eventId) {
        event = await reunionEvents.findOne({
          _id: eventId,
        });
      }
    }

    /* -----------------------------------------------------
         GIFT PACKAGE
      ----------------------------------------------------- */

    let giftPackage = null;

    if (giftPackages && registration.reunion?.packageId) {
      giftPackage = await findGiftPackage(
        giftPackages,
        registration.reunion.packageId,
        registration.reunion.eventId,
      );
    }

    return res.status(200).json({
      success: true,

      data: serializeDocument(registration),

      event: serializeEvent(event),

      giftPackage: serializeGiftPackage(giftPackage),
    });
  } catch (error) {
    console.error("GET /api/registrations/:registrationId error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load registration.",
      code: "registration/load-failed",
    });
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;
