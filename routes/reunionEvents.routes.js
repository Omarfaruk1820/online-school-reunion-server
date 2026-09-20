import express from "express";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import  verifyToken  from "../middleware/verifyToken.js";
import verifyAdmin  from "../middleware/verifyAdmin.js";

const router = express.Router();

// ============================================================
// Constants
// ============================================================

const VALID_EVENT_TYPES = new Set([
  "school-reunion",
  "reunion",
  "school-event",
]);

const VALID_EVENT_STATUS = new Set([
  "draft",
  "published",
  "cancelled",
  "completed",
]);

const VALID_STUDENT_TYPES = new Set(["current", "alumni"]);

const VALID_CLASS_LEVELS = new Set(["6", "7", "8", "9", "10"]);

const VALID_DEPARTMENTS = new Set([
  "science",
  "commerce",
  "humanities",
  "vocational",
]);

const VALID_TSHIRT_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL", "3XL"]);

// ============================================================
// Helpers
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

const normalizeBoolean = (value, defaultValue = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  return defaultValue;
};

const normalizeDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const normalizeObjectId = (value) => {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
};

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  return {
    ...document,

    _id: document._id?.toString?.() || document._id,

    createdBy: document.createdBy
      ? {
          ...document.createdBy,
        }
      : undefined,
  };
};

// ============================================================
// Venue
// ============================================================

const normalizeVenue = (venue) => {
  // Support old string format
  if (typeof venue === "string") {
    const value = normalizeString(venue);

    if (!value) {
      return null;
    }

    return {
      name: value,
      address: "",
      city: "",
      country: "Bangladesh",
    };
  }

  if (!venue || typeof venue !== "object") {
    return null;
  }

  return {
    name: normalizeString(venue.name),
    address: normalizeString(venue.address),
    city: normalizeString(venue.city),
    country: normalizeString(venue.country) || "Bangladesh",
  };
};

// ============================================================
// Eligibility
// ============================================================

const normalizeEligibility = (eligibility = {}) => {
  const studentTypes = Array.isArray(eligibility.studentTypes)
    ? eligibility.studentTypes
        .map(normalizeString)
        .map((value) => value.toLowerCase())
        .filter((value) => VALID_STUDENT_TYPES.has(value))
    : ["current", "alumni"];

  const classLevels = Array.isArray(eligibility.classLevels)
    ? eligibility.classLevels
        .map((value) => normalizeString(String(value)))
        .filter((value) => VALID_CLASS_LEVELS.has(value))
    : ["6", "7", "8", "9", "10"];

  const departments = Array.isArray(eligibility.departments)
    ? eligibility.departments
        .map(normalizeString)
        .map((value) => value.toLowerCase())
        .filter((value) => VALID_DEPARTMENTS.has(value))
    : ["science", "commerce", "humanities", "vocational"];

  return {
    studentTypes: [...new Set(studentTypes)],

    classLevels: [...new Set(classLevels)],

    departments: [...new Set(departments)],
  };
};

// ============================================================
// Gifts
// ============================================================

const normalizeGifts = (gifts = {}) => {
  const items = Array.isArray(gifts.items)
    ? gifts.items.map(normalizeString).filter(Boolean)
    : [];

  return {
    included: gifts.included !== false,

    items,
  };
};

// ============================================================
// Registration settings
// ============================================================

const normalizeRegistration = (registration = {}, registrationOpen = true) => {
  return {
    open:
      typeof registration.open === "boolean"
        ? registration.open
        : registrationOpen,

    requiresAuthentication: registration.requiresAuthentication !== false,

    requiresPhone: registration.requiresPhone !== false,

    requiresConsent: registration.requiresConsent !== false,

    allowMultipleRegistrations:
      registration.allowMultipleRegistrations === true,
  };
};

// ============================================================
// QR configuration
// ============================================================

const normalizeQrCode = (qrCode = {}) => {
  return {
    enabled: qrCode.enabled !== false,

    purpose: normalizeString(qrCode.purpose) || "attendance",

    version: Number(qrCode.version) || 1,
  };
};

// ============================================================
// Capacity
// ============================================================

const normalizeCapacity = (capacity = {}) => {
  const enabled = capacity.enabled === true;

  let maximum = null;

  if (
    capacity.maximum !== null &&
    capacity.maximum !== undefined &&
    capacity.maximum !== ""
  ) {
    const parsedMaximum = Number(capacity.maximum);

    if (Number.isInteger(parsedMaximum) && parsedMaximum > 0) {
      maximum = parsedMaximum;
    }
  }

  return {
    enabled,
    maximum,
    reserved: Number(capacity.reserved) || 0,
  };
};

// ============================================================
// Payment
// ============================================================

const normalizePayment = (payment = {}, paymentRequired = false) => {
  const required = payment.required === true || paymentRequired === true;

  const amount = Number(payment.amount) || 0;

  return {
    required,

    currency: normalizeString(payment.currency) || "BDT",

    amount: amount >= 0 ? amount : 0,

    status:
      normalizeString(payment.status) ||
      (required ? "pending" : "not-required"),
  };
};

// ============================================================
// Features
// ============================================================

const normalizeFeatures = (features = {}) => {
  return {
    registration: features.registration !== false,

    giftDistribution: features.giftDistribution !== false,

    attendanceTracking: features.attendanceTracking !== false,

    schedule: features.schedule !== false,

    gallery: features.gallery !== false,

    announcements: features.announcements !== false,

    sponsors: features.sponsors !== false,
  };
};

// ============================================================
// Event validation
// ============================================================

const validateEventData = (data) => {
  const errors = [];

  if (!data.title) {
    errors.push("Event title is required.");
  }

  if (!data.shortTitle) {
    errors.push("Event short title is required.");
  }

  if (!data.eventDate) {
    errors.push("Event date is required.");
  }

  if (!data.startTime) {
    errors.push("Event start time is required.");
  }

  if (!data.endTime) {
    errors.push("Event end time is required.");
  }

  if (!data.venue?.name) {
    errors.push("Venue name is required.");
  }

  if (data.eventType && !VALID_EVENT_TYPES.has(data.eventType)) {
    errors.push("Invalid event type.");
  }

  if (data.status && !VALID_EVENT_STATUS.has(data.status)) {
    errors.push("Invalid event status.");
  }

  if (
    data.registrationDeadline &&
    data.eventDate &&
    data.registrationDeadline > data.eventDate
  ) {
    errors.push("Registration deadline cannot be after the event date.");
  }

  return errors;
};

// ============================================================
// GET /api/reunion-events/test
// ============================================================

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Reunion events route is working.",
    route: "/api/reunion-events",
  });
});

// ============================================================
// GET /api/reunion-events/active
//
// Returns active registration event.
// ============================================================

router.get("/active", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "reunionEvents collection is not available.",
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
    console.error("GET /api/reunion-events/active error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to load active reunion event.",
    });
  }
});

// ============================================================
// GET /api/reunion-events
//
// Returns all reunion events.
// ============================================================

router.get("/", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "reunionEvents collection is not available.",
      });
    }

    const events = await reunionEvents
      .find({})
      .sort({
        eventDate: 1,
        createdAt: -1,
      })
      .toArray();

    return res.status(200).json({
      success: true,
      count: events.length,
      data: events.map(serializeDocument),
    });
  } catch (error) {
    console.error("GET /api/reunion-events error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to load reunion events.",
    });
  }
});

// ============================================================
// GET /api/reunion-events/:eventId
// ============================================================

router.get("/:eventId", async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "reunionEvents collection is not available.",
      });
    }

    const eventId = normalizeObjectId(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
        message: "Invalid reunion event ID.",
      });
    }

    const event = await reunionEvents.findOne({
      _id: eventId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeDocument(event),
    });
  } catch (error) {
    console.error("GET /api/reunion-events/:eventId error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to load reunion event.",
    });
  }
});

// ============================================================
// POST /api/reunion-events
//
// Admin creates a new reunion event.
// ============================================================

router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "reunionEvents collection is not available.",
      });
    }

    const body = req.body || {};

    const title = normalizeString(body.title);

    const shortTitle = normalizeString(body.shortTitle);

    const slug =
      normalizeString(body.slug) ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const edition = normalizeString(body.edition) || "76 Years Celebration";

    const eventType = normalizeString(body.eventType) || "school-reunion";

    const status = normalizeString(body.status) || "draft";

    const eventDate = normalizeDate(body.eventDate);

    const registrationDeadline = normalizeDate(body.registrationDeadline);

    const startTime = normalizeString(body.startTime);

    const endTime = normalizeString(body.endTime);

    const venue = normalizeVenue(body.venue);

    const registrationOpen = normalizeBoolean(body.registrationOpen, false);

    const paymentRequired = normalizeBoolean(body.paymentRequired, false);

    const errors = validateEventData({
      title,
      shortTitle,
      eventDate,
      startTime,
      endTime,
      venue,
      eventType,
      status,
      registrationDeadline,
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        code: "validation/event-invalid",
        message: errors[0],
        errors,
      });
    }

    // --------------------------------------------------------
    // Only one active registration event
    // --------------------------------------------------------

    if (registrationOpen) {
      const existingActiveEvent = await reunionEvents.findOne({
        registrationOpen: true,
      });

      if (existingActiveEvent) {
        return res.status(409).json({
          success: false,
          code: "reunion/active-event-exists",
          message: "Another reunion event is already open for registration.",
          data: {
            eventId: existingActiveEvent._id.toString(),
            title: existingActiveEvent.title,
          },
        });
      }
    }

    const now = new Date();

    const authenticatedUser = req.user || req.userData || {};

    const eventDocument = {
      title,

      shortTitle,

      slug,

      edition,

      eventType,

      status,

      eventDate,

      weekday:
        normalizeString(body.weekday) ||
        eventDate.toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: body.timezone || "Asia/Dhaka",
        }),

      startTime,

      endTime,

      timezone: normalizeString(body.timezone) || "Asia/Dhaka",

      venue,

      registrationOpen,

      registrationDeadline,

      paymentRequired,

      registration: normalizeRegistration(body.registration, registrationOpen),

      qrCode: normalizeQrCode(body.qrCode),

      capacity: normalizeCapacity(body.capacity),

      payment: normalizePayment(body.payment, paymentRequired),

      gifts: normalizeGifts(body.gifts),

      eligibility: normalizeEligibility(body.eligibility),

      features: normalizeFeatures(body.features),

      description: normalizeString(body.description),

      createdBy: {
        uid: normalizeString(authenticatedUser.uid),

        email: normalizeEmail(authenticatedUser.email),
      },

      createdAt: now,

      updatedAt: now,
    };

    const result = await reunionEvents.insertOne(eventDocument);

    return res.status(201).json({
      success: true,
      message: "Reunion event created successfully.",
      data: {
        ...serializeDocument(eventDocument),
        _id: result.insertedId.toString(),
      },
    });
  } catch (error) {
    console.error("POST /api/reunion-events error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to create reunion event.",
    });
  }
});

// ============================================================
// PATCH /api/reunion-events/:eventId
//
// Admin updates reunion event.
// ============================================================

router.patch("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "reunionEvents collection is not available.",
      });
    }

    const eventId = normalizeObjectId(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
        message: "Invalid reunion event ID.",
      });
    }

    const existingEvent = await reunionEvents.findOne({
      _id: eventId,
    });

    if (!existingEvent) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event was not found.",
      });
    }

    const body = req.body || {};

    const update = {};

    // --------------------------------------------------------
    // Basic fields
    // --------------------------------------------------------

    if (body.title !== undefined) {
      update.title = normalizeString(body.title);
    }

    if (body.shortTitle !== undefined) {
      update.shortTitle = normalizeString(body.shortTitle);
    }

    if (body.slug !== undefined) {
      update.slug = normalizeString(body.slug);
    }

    if (body.edition !== undefined) {
      update.edition = normalizeString(body.edition);
    }

    if (body.eventType !== undefined) {
      update.eventType = normalizeString(body.eventType);
    }

    if (body.status !== undefined) {
      update.status = normalizeString(body.status);
    }

    if (body.eventDate !== undefined) {
      const eventDate = normalizeDate(body.eventDate);

      if (!eventDate) {
        return res.status(400).json({
          success: false,
          code: "validation/invalid-event-date",
          message: "Invalid event date.",
        });
      }

      update.eventDate = eventDate;
    }

    if (body.weekday !== undefined) {
      update.weekday = normalizeString(body.weekday);
    }

    if (body.startTime !== undefined) {
      update.startTime = normalizeString(body.startTime);
    }

    if (body.endTime !== undefined) {
      update.endTime = normalizeString(body.endTime);
    }

    if (body.timezone !== undefined) {
      update.timezone = normalizeString(body.timezone);
    }

    // --------------------------------------------------------
    // Venue
    // --------------------------------------------------------

    if (body.venue !== undefined) {
      const venue = normalizeVenue(body.venue);

      if (!venue?.name) {
        return res.status(400).json({
          success: false,
          code: "validation/invalid-venue",
          message: "Venue name is required.",
        });
      }

      update.venue = venue;
    }

    // --------------------------------------------------------
    // Registration
    // --------------------------------------------------------

    if (body.registrationOpen !== undefined) {
      update.registrationOpen = normalizeBoolean(body.registrationOpen, false);
    }

    if (body.registrationDeadline !== undefined) {
      const deadline = body.registrationDeadline
        ? normalizeDate(body.registrationDeadline)
        : null;

      if (body.registrationDeadline && !deadline) {
        return res.status(400).json({
          success: false,
          code: "validation/invalid-registration-deadline",
          message: "Invalid registration deadline.",
        });
      }

      update.registrationDeadline = deadline;
    }

    if (body.registration !== undefined) {
      update.registration = normalizeRegistration(
        body.registration,
        update.registrationOpen ?? existingEvent.registrationOpen,
      );
    }

    // --------------------------------------------------------
    // QR
    // --------------------------------------------------------

    if (body.qrCode !== undefined) {
      update.qrCode = normalizeQrCode(body.qrCode);
    }

    // --------------------------------------------------------
    // Capacity
    // --------------------------------------------------------

    if (body.capacity !== undefined) {
      update.capacity = normalizeCapacity(body.capacity);
    }

    // --------------------------------------------------------
    // Payment
    // --------------------------------------------------------

    if (body.paymentRequired !== undefined) {
      update.paymentRequired = normalizeBoolean(body.paymentRequired, false);
    }

    if (body.payment !== undefined) {
      update.payment = normalizePayment(
        body.payment,
        update.paymentRequired ?? existingEvent.paymentRequired,
      );
    }

    // --------------------------------------------------------
    // Gifts
    // --------------------------------------------------------

    if (body.gifts !== undefined) {
      update.gifts = normalizeGifts(body.gifts);
    }

    // --------------------------------------------------------
    // Eligibility
    // --------------------------------------------------------

    if (body.eligibility !== undefined) {
      update.eligibility = normalizeEligibility(body.eligibility);
    }

    // --------------------------------------------------------
    // Features
    // --------------------------------------------------------

    if (body.features !== undefined) {
      update.features = normalizeFeatures(body.features);
    }

    // --------------------------------------------------------
    // Description
    // --------------------------------------------------------

    if (body.description !== undefined) {
      update.description = normalizeString(body.description);
    }

    // --------------------------------------------------------
    // Validate merged event
    // --------------------------------------------------------

    const mergedEvent = {
      ...existingEvent,
      ...update,
    };

    const validationErrors = validateEventData(mergedEvent);

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        code: "validation/event-invalid",
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    // --------------------------------------------------------
    // Prevent multiple active events
    // --------------------------------------------------------

    if (
      update.registrationOpen === true &&
      existingEvent.registrationOpen !== true
    ) {
      const anotherActiveEvent = await reunionEvents.findOne({
        _id: {
          $ne: eventId,
        },
        registrationOpen: true,
      });

      if (anotherActiveEvent) {
        return res.status(409).json({
          success: false,
          code: "reunion/active-event-exists",
          message: "Another reunion event is already open for registration.",
          data: {
            eventId: anotherActiveEvent._id.toString(),
            title: anotherActiveEvent.title,
          },
        });
      }
    }

    update.updatedAt = new Date();

    const result = await reunionEvents.findOneAndUpdate(
      {
        _id: eventId,
      },
      {
        $set: update,
      },
      {
        returnDocument: "after",
      },
    );

    const updatedEvent = result?.value || result;

    return res.status(200).json({
      success: true,
      message: "Reunion event updated successfully.",
      data: serializeDocument(updatedEvent),
    });
  } catch (error) {
    console.error("PATCH /api/reunion-events/:eventId error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to update reunion event.",
    });
  }
});

// ============================================================
// DELETE /api/reunion-events/:eventId
//
// Admin deletes an event only when there are no registrations.
// ============================================================

router.delete("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    await connectDB();

    const { reunionEvents, registrations } = getCollections();

    if (!reunionEvents || !registrations) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Required MongoDB collections are not available.",
      });
    }

    const eventId = normalizeObjectId(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        code: "validation/invalid-event-id",
        message: "Invalid reunion event ID.",
      });
    }

    const event = await reunionEvents.findOne({
      _id: eventId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event was not found.",
      });
    }

    // --------------------------------------------------------
    // Check registrations
    // --------------------------------------------------------

    const registrationCount = await registrations.countDocuments({
      "reunion.eventId": eventId,
    });

    if (registrationCount > 0) {
      return res.status(409).json({
        success: false,
        code: "reunion/event-has-registrations",
        message:
          "This event cannot be deleted because registrations already exist.",
        data: {
          registrationCount,
        },
      });
    }

    await reunionEvents.deleteOne({
      _id: eventId,
    });

    return res.status(200).json({
      success: true,
      message: "Reunion event deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE /api/reunion-events/:eventId error:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/server-error",
      message: "Failed to delete reunion event.",
    });
  }
});

// ============================================================
// Export
// ============================================================

export default router;
