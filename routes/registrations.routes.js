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

/* =========================================================
   BASIC HELPERS
========================================================= */

const cleanString = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const normalizeEmail = (value) => {
  return cleanString(value).toLowerCase();
};

const normalizeStudentType = (value) => {
  return cleanString(value).toLowerCase();
};

const normalizeDepartment = (value) => {
  return cleanString(value).toLowerCase();
};

const normalizeClassLevel = (value) => {
  return cleanString(value);
};

const normalizeTshirtSize = (value) => {
  return cleanString(value).toUpperCase();
};

const isSeniorClass = (classLevel) => {
  return SENIOR_CLASS_LEVELS.includes(normalizeClassLevel(classLevel));
};

const isValidObjectId = (value) => {
  if (value instanceof ObjectId) {
    return true;
  }

  return typeof value === "string" && ObjectId.isValid(value);
};

const toObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectId) {
    return value;
  }

  if (typeof value === "string" && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }

  return null;
};

/* =========================================================
   REGISTRATION ID
========================================================= */

const createRegistrationId = () => {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `SR-2027-${randomPart}`;
};

/* =========================================================
   QR TOKEN
========================================================= */

const createQrToken = () => {
  return crypto.randomBytes(24).toString("hex");
};

/*
  Never send qrCode.token to frontend.
*/
const serializeQrCode = (qrCode) => {
  if (!qrCode) {
    return null;
  }

  return {
    enabled: Boolean(qrCode.enabled),
    purpose: qrCode.purpose || "attendance",
    version: qrCode.version || 1,
    status: qrCode.status || "active",
    generatedAt: qrCode.generatedAt || null,
  };
};

/* =========================================================
   DOCUMENT SERIALIZATION
========================================================= */

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  const data = {
    ...document,
  };

  if (data._id instanceof ObjectId) {
    data._id = data._id.toString();
  }

  if (data.reunion) {
    data.reunion = {
      ...data.reunion,
    };

    if (data.reunion.eventId instanceof ObjectId) {
      data.reunion.eventId = data.reunion.eventId.toString();
    }

    if (data.reunion.packageDatabaseId instanceof ObjectId) {
      data.reunion.packageDatabaseId =
        data.reunion.packageDatabaseId.toString();
    }
  }

  if (data.qrCode) {
    data.qrCode = serializeQrCode(data.qrCode);
  }

  return data;
};

/* =========================================================
   EVENT SERIALIZATION
========================================================= */

const serializeEvent = (event) => {
  if (!event) {
    return null;
  }

  const data = {
    ...event,
  };

  if (data._id instanceof ObjectId) {
    data._id = data._id.toString();
  }

  if (data._id === undefined && event.id) {
    data.id = String(event.id);
  }

  if (data.registration) {
    data.registration = {
      ...data.registration,
    };
  }

  return data;
};

/* =========================================================
   GIFT PACKAGE SERIALIZATION
========================================================= */

const serializeGiftPackage = (giftPackage) => {
  if (!giftPackage) {
    return null;
  }

  const data = {
    ...giftPackage,
  };

  if (data._id instanceof ObjectId) {
    data._id = data._id.toString();
  }

  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => {
      if (item && typeof item === "object") {
        return {
          ...item,
        };
      }

      return item;
    });
  }

  return data;
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

  if (event.registration && event.registration.open === false) {
    return false;
  }

  if (event.registrationDeadline) {
    const deadline = new Date(event.registrationDeadline);

    if (!Number.isNaN(deadline.getTime()) && new Date() > deadline) {
      return false;
    }
  }

  return true;
};

/* =========================================================
   GIFT PACKAGE HELPER
========================================================= */

const findGiftPackage = async (giftPackages, packageId, eventId = null) => {
  if (!giftPackages || !packageId) {
    return null;
  }

  const normalizedPackageId = cleanString(packageId);

  const possibleQueries = [
    {
      packageId: normalizedPackageId,
    },
    {
      id: normalizedPackageId,
    },
  ];

  const packageObjectId = toObjectId(normalizedPackageId);

  if (packageObjectId) {
    possibleQueries.push({
      _id: packageObjectId,
    });
  }

  let giftPackage = null;

  for (const query of possibleQueries) {
    giftPackage = await giftPackages.findOne(query);

    if (giftPackage) {
      break;
    }
  }

  if (!giftPackage) {
    return null;
  }

  /*
    If package has eventId,
    make sure it belongs to requested event.
  */
  if (giftPackage.eventId && eventId) {
    const packageEventId = toObjectId(giftPackage.eventId);

    const requestedEventId = toObjectId(eventId);

    if (
      packageEventId &&
      requestedEventId &&
      !packageEventId.equals(requestedEventId)
    ) {
      return null;
    }

    if (!packageEventId && String(giftPackage.eventId) !== String(eventId)) {
      return null;
    }
  }

  if (giftPackage.active === false) {
    return null;
  }

  return giftPackage;
};

/* =========================================================
   T-SHIRT REQUIREMENT
========================================================= */

const packageRequiresTshirtSize = (giftPackage) => {
  if (!giftPackage) {
    return false;
  }

  /*
    Support different possible package structures.
  */

  if (giftPackage.tshirt && typeof giftPackage.tshirt === "object") {
    return (
      giftPackage.tshirt.included !== false &&
      (giftPackage.tshirt.required === true ||
        giftPackage.tshirt.requiresSize === true)
    );
  }

  if (giftPackage.tShirt && typeof giftPackage.tShirt === "object") {
    return (
      giftPackage.tShirt.included !== false &&
      (giftPackage.tShirt.required === true ||
        giftPackage.tShirt.requiresSize === true)
    );
  }

  if (Array.isArray(giftPackage.items)) {
    const tshirtItem = giftPackage.items.find((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const id = cleanString(item.id).toLowerCase();

      const name = cleanString(item.name).toLowerCase();

      return (
        id === "tshirt" ||
        id === "t-shirt" ||
        name.includes("t-shirt") ||
        name.includes("tshirt")
      );
    });

    if (tshirtItem) {
      return (
        tshirtItem.included !== false &&
        (tshirtItem.requiresSize === true || tshirtItem.required === true)
      );
    }
  }

  return false;
};

/* =========================================================
   ROUTE: TEST
========================================================= */

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Registrations route is working.",
    route: "/api/registrations/test",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   ROUTE: GET ACTIVE EVENT + PACKAGE
   GET /api/registrations
========================================================= */

router.get("/", async (req, res) => {
  try {
    const { reunionEvents, giftPackages } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const event = await findActiveReunionEvent(reunionEvents);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "No active reunion event is available for registration.",
        code: "registration/no-active-event",
      });
    }

    if (!isRegistrationOpen(event)) {
      return res.status(403).json({
        success: false,
        message: "Registration is currently closed.",
        code: "registration/closed",
      });
    }

    let packageOptions = [];

    if (giftPackages) {
      const eventId = event._id;

      const eventIdString =
        eventId instanceof ObjectId ? eventId.toString() : String(eventId);

      const packageDocuments = await giftPackages
        .find({
          active: {
            $ne: false,
          },
        })
        .toArray();

      packageOptions = packageDocuments
        .filter((pkg) => {
          if (!pkg.eventId) {
            return true;
          }

          const pkgEventId = toObjectId(pkg.eventId);

          if (pkgEventId && eventId) {
            const normalizedEventId = toObjectId(eventId);

            if (normalizedEventId) {
              return pkgEventId.equals(normalizedEventId);
            }
          }

          return String(pkg.eventId) === eventIdString;
        })
        .map(serializeGiftPackage);
    }

    return res.status(200).json({
      success: true,
      data: {
        event: serializeEvent(event),
        packageOptions,
      },
    });
  } catch (error) {
    console.error("GET /api/registrations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reunion registration information.",
      code: "registration/load-failed",
    });
  }
});

/* =========================================================
   ROUTE: REGISTER
   POST /api/registrations/register
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
        code: "database/event-collection-not-found",
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

    /*
        -----------------------------------------------------
        1. Read request data
        -----------------------------------------------------
      */

    const participant = req.body?.participant || {};

    const schoolInfo = req.body?.schoolInfo || {};

    const reunion = req.body?.reunion || {};

    const consent = req.body?.consent || {};

    const name = cleanString(
      participant.name ||
        req.body?.name ||
        req.user.name ||
        req.user.displayName,
    );

    const email = normalizeEmail(
      participant.email || req.body?.email || req.user.email,
    );

    const phone = cleanString(participant.phone || req.body?.phone);

    const district = cleanString(participant.district || req.body?.district);

    const city = cleanString(participant.city || req.body?.city);

    const studentType = normalizeStudentType(
      schoolInfo.studentType || req.body?.studentType,
    );

    const classLevel = normalizeClassLevel(
      schoolInfo.classLevel || req.body?.classLevel,
    );

    const batchYearValue = schoolInfo.batchYear ?? req.body?.batchYear;

    const batchYear = Number(batchYearValue);

    const department = normalizeDepartment(
      schoolInfo.department || req.body?.department,
    );

    const packageId = cleanString(
      reunion.packageId || req.body?.packageId || DEFAULT_PACKAGE_ID,
    );

    const tshirtSize = normalizeTshirtSize(
      reunion.tshirtSize ||
        reunion.tShirtSize ||
        req.body?.tshirtSize ||
        req.body?.tShirtSize,
    );

    const agreedToRules = Boolean(
      consent.agreedToRules ?? req.body?.agreeToRules,
    );

    /*
        -----------------------------------------------------
        2. Basic validation
        -----------------------------------------------------
      */

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

    if (req.user.email && normalizeEmail(req.user.email) !== email) {
      return res.status(403).json({
        success: false,
        message:
          "Registration email must match your authenticated Firebase account.",
        code: "auth/email-mismatch",
      });
    }

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

    if (!VALID_STUDENT_TYPES.includes(studentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid student type.",
        code: "validation/invalid-student-type",
      });
    }

    if (!VALID_CLASS_LEVELS.includes(classLevel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid class level.",
        code: "validation/invalid-class-level",
      });
    }

    if (
      !Number.isInteger(batchYear) ||
      batchYear < MIN_BATCH_YEAR ||
      batchYear > MAX_BATCH_YEAR
    ) {
      return res.status(400).json({
        success: false,
        message: `Batch year must be between ${MIN_BATCH_YEAR} and ${MAX_BATCH_YEAR}.`,
        code: "validation/invalid-batch-year",
      });
    }

    /*
        Department is required for class 9 and 10.
      */

    if (isSeniorClass(classLevel)) {
      if (!VALID_DEPARTMENTS.includes(department)) {
        return res.status(400).json({
          success: false,
          message: "Department is required for class 9 and 10.",
          code: "validation/department-required",
        });
      }
    }

    /*
        For class 6-8 department should be null.
      */

    const finalDepartment = isSeniorClass(classLevel) ? department : null;

    if (!packageId) {
      return res.status(400).json({
        success: false,
        message: "Reunion package is required.",
        code: "validation/package-required",
      });
    }

    if (!agreedToRules) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the reunion rules.",
        code: "validation/consent-required",
      });
    }

    /*
        -----------------------------------------------------
        3. Find active event
        -----------------------------------------------------
      */

    const event = await findActiveReunionEvent(reunionEvents);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "No active reunion event is available.",
        code: "registration/no-active-event",
      });
    }

    if (!isRegistrationOpen(event)) {
      return res.status(403).json({
        success: false,
        message: "Registration is currently closed.",
        code: "registration/closed",
      });
    }

    const eventId = event._id;

    /*
        -----------------------------------------------------
        4. Find gift package
        -----------------------------------------------------
      */

    const giftPackage = await findGiftPackage(giftPackages, packageId, eventId);

    if (!giftPackage) {
      return res.status(404).json({
        success: false,
        message: "Selected reunion package was not found.",
        code: "registration/package-not-found",
      });
    }

    /*
        -----------------------------------------------------
        5. Validate T-shirt size
        -----------------------------------------------------
      */

    const requiresTshirtSize = packageRequiresTshirtSize(giftPackage);

    if (requiresTshirtSize && !VALID_TSHIRT_SIZES.includes(tshirtSize)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid T-shirt size.",
        code: "validation/tshirt-size-required",
      });
    }

    if (tshirtSize && !VALID_TSHIRT_SIZES.includes(tshirtSize)) {
      return res.status(400).json({
        success: false,
        message: "Invalid T-shirt size.",
        code: "validation/invalid-tshirt-size",
      });
    }

    /*
        -----------------------------------------------------
        6. Check duplicate registration
        -----------------------------------------------------
      */

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
        message: "You are already registered for this reunion event.",
        code: "registration/already-registered",
        registrationId: existingRegistration.registrationId,
      });
    }

    /*
        -----------------------------------------------------
        7. Capacity check
        -----------------------------------------------------
      */

    if (event.capacity?.enabled === true) {
      const maximum = Number(event.capacity.maximum);

      if (Number.isFinite(maximum) && maximum > 0) {
        const currentCount = await registrations.countDocuments({
          "reunion.eventId": eventId,
          status: {
            $ne: "cancelled",
          },
        });

        if (currentCount >= maximum) {
          return res.status(409).json({
            success: false,
            message: "Registration capacity has been reached.",
            code: "registration/capacity-reached",
          });
        }
      }
    }

    /*
        -----------------------------------------------------
        8. Create registration ID + QR token
        -----------------------------------------------------
      */

    const registrationId = createRegistrationId();

    const qrToken = createQrToken();

    const now = new Date();

    /*
        -----------------------------------------------------
        9. Create registration document
        -----------------------------------------------------
      */

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
        eventId,
        eventTitle: event.title || DEFAULT_EVENT_TITLE,

        packageId: giftPackage.packageId || giftPackage.id || packageId,

        packageDatabaseId: giftPackage._id || null,

        packageName:
          giftPackage.name || giftPackage.title || "General Reunion Package",

        tShirt: tshirtSize || null,
      },

      consent: {
        agreedToRules: true,
        agreedAt: now,
      },

      status: "confirmed",

      paymentStatus:
        event.paymentRequired === true ? "pending" : "not-required",

      qrCode: {
        enabled: event.qrCode?.enabled !== false,

        purpose: event.qrCode?.purpose || "attendance",

        version: event.qrCode?.version || 1,

        token: qrToken,

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

    /*
        -----------------------------------------------------
        10. Insert registration
        -----------------------------------------------------
      */

    let insertResult;

    try {
      insertResult = await registrations.insertOne(registrationDocument);
    } catch (error) {
      /*
          MongoDB duplicate-key protection.

          This is important if two requests arrive
          almost simultaneously.
        */

      if (error?.code === 11000) {
        const duplicate = await registrations.findOne({
          uid,
          "reunion.eventId": eventId,
          status: {
            $ne: "cancelled",
          },
        });

        return res.status(409).json({
          success: false,
          message: "You are already registered for this reunion event.",
          code: "registration/already-registered",
          registrationId: duplicate?.registrationId || null,
        });
      }

      throw error;
    }

    /*
        -----------------------------------------------------
        11. Update users collection
        -----------------------------------------------------
      */

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

    /*
        -----------------------------------------------------
        12. Update student/alumni profile
        -----------------------------------------------------
      */

    const profileData = {
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
    };

    if (studentType === "current") {
      if (studentProfiles) {
        await studentProfiles.updateOne(
          {
            uid,
          },
          {
            $set: profileData,

            $setOnInsert: {
              createdAt: now,
            },
          },
          {
            upsert: true,
          },
        );
      }
    } else {
      if (alumniProfiles) {
        await alumniProfiles.updateOne(
          {
            uid,
          },
          {
            $set: profileData,

            $setOnInsert: {
              createdAt: now,
            },
          },
          {
            upsert: true,
          },
        );
      }
    }

    /*
        -----------------------------------------------------
        13. Response
        -----------------------------------------------------
      */

    return res.status(201).json({
      success: true,
      message: "Registration completed successfully.",

      data: {
        registrationId,

        databaseId: insertResult.insertedId.toString(),

        status: registrationDocument.status,

        paymentStatus: registrationDocument.paymentStatus,

        event: {
          id:
            eventId instanceof ObjectId ? eventId.toString() : String(eventId),

          title: event.title || DEFAULT_EVENT_TITLE,

          eventDate: event.eventDate || null,

          startTime: event.startTime || null,

          endTime: event.endTime || null,

          venue: event.venue || null,
        },

        participant: {
          name,
          email,
          phone,
        },

        schoolInfo: {
          studentType,
          classLevel,
          batchYear,
          department: finalDepartment,
        },

        reunion: {
          packageId: giftPackage.packageId || giftPackage.id || packageId,

          packageName:
            giftPackage.name || giftPackage.title || "General Reunion Package",

          tShirt: tshirtSize || null,
        },

        qrCode: {
          enabled: registrationDocument.qrCode.enabled,

          purpose: registrationDocument.qrCode.purpose,

          version: registrationDocument.qrCode.version,

          status: registrationDocument.qrCode.status,

          generatedAt: registrationDocument.qrCode.generatedAt,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/registrations/register error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to complete reunion registration.",
      code: "registration/create-failed",
    });
  }
});

/* =========================================================
   ROUTE: MY EVENTS
   GET /api/registrations/my-events

   IMPORTANT:
   This route MUST come before /:registrationId
========================================================= */

router.get("/my-events", verifyToken, async (req, res) => {
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

    console.log("MY EVENTS ROUTE HIT");

    console.log("MY EVENTS UID:", uid);

    /*
        Get all registrations belonging
        to authenticated user.
      */

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

    /*
        No registrations.
      */

    if (!registrationDocuments.length) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    /*
        Attach event + gift package
        to each registration.
      */

    const data = await Promise.all(
      registrationDocuments.map(async (registration) => {
        let event = null;
        let giftPackage = null;

        /*
                Find event using:

                reunion.eventId
              */

        if (reunionEvents && registration.reunion?.eventId) {
          const eventId = toObjectId(registration.reunion.eventId);

          if (eventId) {
            event = await reunionEvents.findOne({
              _id: eventId,
            });
          }
        }

        /*
                Find gift package.
              */

        if (giftPackages && registration.reunion?.packageId) {
          giftPackage = await findGiftPackage(
            giftPackages,

            registration.reunion.packageId,

            registration.reunion.eventId,
          );
        }

        return {
          registration: serializeDocument(registration),

          event: serializeEvent(event),

          giftPackage: serializeGiftPackage(giftPackage),
        };
      }),
    );

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("GET /api/registrations/my-events error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your reunion events.",
      code: "registration/my-events-failed",
    });
  }
});

/* =========================================================
   ROUTE: MY REGISTRATION
   GET /api/registrations/my-registration

   Returns the user's registration for
   the currently active event.
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

    let event = reunionEvents
      ? await findActiveReunionEvent(reunionEvents)
      : null;

    /*
        First try the active event.
      */

    let registration = null;

    if (event?._id) {
      registration = await registrations.findOne({
        uid,

        "reunion.eventId": event._id,

        status: {
          $ne: "cancelled",
        },
      });
    }

    /*
        If no active-event registration
        was found, return latest registration.

        This makes the endpoint more useful
        for dashboard/history scenarios.
      */

    if (!registration) {
      registration = await registrations.findOne(
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
    }

    /*
        User has no registration.
      */

    if (!registration) {
      return res.status(200).json({
        success: true,
        registered: false,
        data: null,
      });
    }

    /*
        If active event was not found,
        try loading event from registration.
      */

    if (!event && reunionEvents && registration.reunion?.eventId) {
      const eventId = toObjectId(registration.reunion.eventId);

      if (eventId) {
        event = await reunionEvents.findOne({
          _id: eventId,
        });
      }
    }

    /*
        Find package.
      */

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
      registered: true,

      data: {
        registration: serializeDocument(registration),

        event: serializeEvent(event),

        giftPackage: serializeGiftPackage(giftPackage),
      },
    });
  } catch (error) {
    console.error("GET /api/registrations/my-registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your registration.",
      code: "registration/my-registration-failed",
    });
  }
});

/* =========================================================
   ROUTE: GET REGISTRATION BY ID
   GET /api/registrations/:registrationId

   IMPORTANT:
   This MUST remain after:
   /test
   /
   /register
   /my-events
   /my-registration
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

    /*
        Security:
        Search by BOTH registrationId and uid.
        Therefore one user cannot access
        another user's registration.
      */

    const registration = await registrations.findOne({
      registrationId,

      uid: req.user.uid,
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration not found.",
        code: "registration/not-found",
      });
    }

    /*
        Find event.
      */

    let event = null;

    if (reunionEvents && registration.reunion?.eventId) {
      const eventId = toObjectId(registration.reunion.eventId);

      if (eventId) {
        event = await reunionEvents.findOne({
          _id: eventId,
        });
      }
    }

    /*
        Find gift package.
      */

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

      data: {
        registration: serializeDocument(registration),

        event: serializeEvent(event),

        giftPackage: serializeGiftPackage(giftPackage),
      },
    });
  } catch (error) {
    console.error("GET /api/registrations/:registrationId error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load registration.",
      code: "registration/get-failed",
    });
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;
