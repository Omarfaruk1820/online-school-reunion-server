import express from "express";
import { ObjectId } from "mongodb";

import { getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";
import verifyAdmin from "../middleware/verifyAdmin.js";

const router = express.Router();

/* =========================================================
   CONSTANTS
========================================================= */

const VALID_EVENT_TYPES = [
  "school-reunion",
  "reunion",
  "school-event",
  "alumni-event",
];

const VALID_EVENT_STATUSES = [
  "draft",
  "published",
  "active",
  "closed",
  "cancelled",
  "archived",
];

const VALID_STUDENT_TYPES = ["current", "alumni"];

const VALID_CLASS_LEVELS = ["6", "7", "8", "9", "10"];

const VALID_DEPARTMENTS = ["science", "commerce", "humanities", "vocational"];

const VALID_TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const VALID_PAYMENT_STATUSES = [
  "not-required",
  "pending",
  "paid",
  "failed",
  "refunded",
];

const VALID_QR_PURPOSES = ["attendance"];

const DEFAULT_TIMEZONE = "Asia/Dhaka";

/* =========================================================
   BASIC HELPERS
========================================================= */

const cleanString = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const normalizeString = (value, fallback = "") => {
  const cleaned = cleanString(value);

  return cleaned || fallback;
};

const normalizeLowerString = (value, fallback = "") => {
  const cleaned = cleanString(value).toLowerCase();

  return cleaned || fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }

    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return fallback;
};

const normalizeObjectId = (value) => {
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

const isValidObjectId = (value) => {
  return Boolean(normalizeObjectId(value));
};

const normalizeDate = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const normalizeDateOnly = (value) => {
  const dateString = cleanString(value);

  if (!dateString) {
    return "";
  }

  /*
    Accept YYYY-MM-DD.
  */

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
};

/* =========================================================
   VENUE
========================================================= */

const normalizeVenue = (venue) => {
  /*
    Support old structure:

    venue: "School Campus"

    and new structure:

    venue: {
      name,
      address,
      city,
      country
    }
  */

  if (typeof venue === "string") {
    return {
      name: cleanString(venue),
      address: "",
      city: "",
      country: "",
    };
  }

  if (!venue || typeof venue !== "object") {
    return {
      name: "",
      address: "",
      city: "",
      country: "",
    };
  }

  return {
    name: cleanString(venue.name),

    address: cleanString(venue.address),

    city: cleanString(venue.city),

    country: cleanString(venue.country),
  };
};

/* =========================================================
   ELIGIBILITY
========================================================= */

const normalizeEligibility = (eligibility) => {
  const source = eligibility || {};

  const studentTypes = Array.isArray(source.studentTypes)
    ? source.studentTypes
        .map(normalizeLowerString)
        .filter((value) => VALID_STUDENT_TYPES.includes(value))
    : [...VALID_STUDENT_TYPES];

  const classLevels = Array.isArray(source.classLevels)
    ? source.classLevels
        .map(cleanString)
        .filter((value) => VALID_CLASS_LEVELS.includes(value))
    : [...VALID_CLASS_LEVELS];

  const departments = Array.isArray(source.departments)
    ? source.departments
        .map(normalizeLowerString)
        .filter((value) => VALID_DEPARTMENTS.includes(value))
    : [...VALID_DEPARTMENTS];

  return {
    studentTypes: studentTypes.length
      ? [...new Set(studentTypes)]
      : [...VALID_STUDENT_TYPES],

    classLevels: classLevels.length
      ? [...new Set(classLevels)]
      : [...VALID_CLASS_LEVELS],

    departments: departments.length
      ? [...new Set(departments)]
      : [...VALID_DEPARTMENTS],
  };
};

/* =========================================================
   GIFTS
========================================================= */

const normalizeGiftItem = (item, index) => {
  /*
    Support:

    "Commemorative Reunion Bag"

    OR

    {
      id: "bag",
      name: "Commemorative Reunion Bag",
      ...
    }
  */

  if (typeof item === "string") {
    const name = cleanString(item);

    if (!name) {
      return null;
    }

    return {
      id: `gift-${index + 1}`,

      name,

      description: "",

      quantity: 1,

      included: true,

      requiresSize: false,
    };
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const name = cleanString(item.name);

  if (!name) {
    return null;
  }

  return {
    id: cleanString(item.id) || `gift-${index + 1}`,

    name,

    description: cleanString(item.description),

    quantity: Math.max(1, Number(item.quantity) || 1),

    included: normalizeBoolean(item.included, true),

    requiresSize: normalizeBoolean(item.requiresSize, false),
  };
};

const normalizeGifts = (gifts) => {
  const source = gifts || {};

  const rawItems = Array.isArray(source.items) ? source.items : [];

  const items = rawItems.map(normalizeGiftItem).filter(Boolean);

  return {
    included: normalizeBoolean(source.included, items.length > 0),

    items,
  };
};

/* =========================================================
   REGISTRATION SETTINGS
========================================================= */

const normalizeRegistration = (registration, registrationOpen) => {
  const source = registration || {};

  const open =
    registrationOpen !== undefined
      ? registrationOpen
      : normalizeBoolean(source.open, true);

  return {
    open,

    requiresAuthentication: normalizeBoolean(
      source.requiresAuthentication,
      true,
    ),

    requiresPhone: normalizeBoolean(source.requiresPhone, true),

    requiresConsent: normalizeBoolean(source.requiresConsent, true),

    allowMultipleRegistrations: normalizeBoolean(
      source.allowMultipleRegistrations,
      false,
    ),
  };
};

/* =========================================================
   QR CODE
========================================================= */

const normalizeQrCode = (qrCode) => {
  const source = qrCode || {};

  const purpose = cleanString(source.purpose).toLowerCase();

  return {
    enabled: normalizeBoolean(source.enabled, true),

    purpose: VALID_QR_PURPOSES.includes(purpose) ? purpose : "attendance",

    version: Math.max(1, Number(source.version) || 1),
  };
};

/* =========================================================
   CAPACITY
========================================================= */

const normalizeCapacity = (capacity) => {
  const source = capacity || {};

  const enabled = normalizeBoolean(source.enabled, false);

  let maximum = Number(source.maximum);

  if (!Number.isFinite(maximum) || maximum <= 0) {
    maximum = null;
  } else {
    maximum = Math.floor(maximum);
  }

  let reserved = Number(source.reserved);

  if (!Number.isFinite(reserved) || reserved < 0) {
    reserved = 0;
  } else {
    reserved = Math.floor(reserved);
  }

  return {
    enabled,

    maximum,

    reserved,
  };
};

/* =========================================================
   PAYMENT
========================================================= */

const normalizePayment = (payment, paymentRequired) => {
  const source = payment || {};

  const required =
    paymentRequired !== undefined
      ? paymentRequired
      : normalizeBoolean(source.required, false);

  let amount = Number(source.amount);

  if (!Number.isFinite(amount) || amount < 0) {
    amount = 0;
  }

  return {
    required,

    currency: cleanString(source.currency).toUpperCase() || "BDT",

    amount,

    status: VALID_PAYMENT_STATUSES.includes(
      cleanString(source.status).toLowerCase(),
    )
      ? cleanString(source.status).toLowerCase()
      : required
        ? "pending"
        : "not-required",
  };
};

/* =========================================================
   FEATURES
========================================================= */

const normalizeFeatures = (features) => {
  const source = features || {};

  return {
    registration: normalizeBoolean(source.registration, true),

    giftDistribution: normalizeBoolean(source.giftDistribution, true),

    attendanceTracking: normalizeBoolean(source.attendanceTracking, true),

    schedule: normalizeBoolean(source.schedule, true),

    gallery: normalizeBoolean(source.gallery, true),

    announcements: normalizeBoolean(source.announcements, true),

    sponsors: normalizeBoolean(source.sponsors, true),
  };
};

/* =========================================================
   EVENT DATA NORMALIZATION
========================================================= */

const normalizeEventData = (body, existingEvent = null) => {
  const source = body || {};

  const existing = existingEvent || {};

  const title = normalizeString(source.title, existing.title || "");

  const shortTitle = normalizeString(
    source.shortTitle,
    existing.shortTitle || title,
  );

  const slug = normalizeLowerString(
    source.slug,
    existing.slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
  );

  const eventType = normalizeLowerString(
    source.eventType,
    existing.eventType || "school-reunion",
  );

  const status = normalizeLowerString(
    source.status,
    existing.status || "draft",
  );

  const eventDate = normalizeDateOnly(source.eventDate ?? existing.eventDate);

  const weekday = normalizeString(source.weekday, existing.weekday || "");

  const startTime = normalizeString(
    source.startTime,
    existing.startTime || "09:00",
  );

  const endTime = normalizeString(source.endTime, existing.endTime || "17:00");

  const timezone = normalizeString(
    source.timezone,
    existing.timezone || DEFAULT_TIMEZONE,
  );

  const venue = normalizeVenue(source.venue ?? existing.venue);

  const registrationOpen = normalizeBoolean(
    source.registrationOpen,
    existing.registrationOpen !== undefined ? existing.registrationOpen : true,
  );

  let registrationDeadline =
    source.registrationDeadline !== undefined
      ? normalizeDate(source.registrationDeadline)
      : existing.registrationDeadline
        ? normalizeDate(existing.registrationDeadline)
        : null;

  const registration = normalizeRegistration(
    source.registration ?? existing.registration,
    registrationOpen,
  );

  const paymentRequired = normalizeBoolean(
    source.paymentRequired,
    existing.paymentRequired || false,
  );

  const payment = normalizePayment(
    source.payment ?? existing.payment,
    paymentRequired,
  );

  const eligibility = normalizeEligibility(
    source.eligibility ?? existing.eligibility,
  );

  const gifts = normalizeGifts(source.gifts ?? existing.gifts);

  const qrCode = normalizeQrCode(source.qrCode ?? existing.qrCode);

  const capacity = normalizeCapacity(source.capacity ?? existing.capacity);

  const features = normalizeFeatures(source.features ?? existing.features);

  /*
    If registration is closed,
    deadline does not need to be forced.
  */

  if (
    registrationOpen === false &&
    source.registrationDeadline === undefined &&
    !existing.registrationDeadline
  ) {
    registrationDeadline = null;
  }

  return {
    title,

    shortTitle,

    slug,

    edition: normalizeString(
      source.edition,
      existing.edition || "76 Years Celebration",
    ),

    eventType,

    status,

    eventDate,

    weekday,

    startTime,

    endTime,

    timezone,

    venue,

    registrationOpen,

    registrationDeadline,

    paymentRequired,

    registration,

    qrCode,

    capacity,

    payment,

    gifts,

    eligibility,

    features,
  };
};

/* =========================================================
   EVENT VALIDATION
========================================================= */

const validateEventData = (data) => {
  const errors = [];

  if (!data.title) {
    errors.push("Event title is required.");
  }

  if (!VALID_EVENT_TYPES.includes(data.eventType)) {
    errors.push("Invalid event type.");
  }

  if (!VALID_EVENT_STATUSES.includes(data.status)) {
    errors.push("Invalid event status.");
  }

  if (!data.eventDate) {
    errors.push("Event date is required.");
  }

  if (data.registrationDeadline) {
    const deadline = new Date(data.registrationDeadline);

    if (Number.isNaN(deadline.getTime())) {
      errors.push("Invalid registration deadline.");
    }
  }

  if (
    data.capacity.enabled &&
    (!data.capacity.maximum || data.capacity.maximum <= 0)
  ) {
    errors.push(
      "Capacity maximum must be greater than zero when capacity is enabled.",
    );
  }

  if (data.payment.required && data.payment.amount < 0) {
    errors.push("Payment amount cannot be negative.");
  }

  if (!data.eligibility.studentTypes.length) {
    errors.push("At least one eligible student type is required.");
  }

  if (!data.eligibility.classLevels.length) {
    errors.push("At least one eligible class level is required.");
  }

  return errors;
};

/* =========================================================
   SERIALIZATION
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

  /*
    Convert date objects to ISO strings.
  */

  if (data.createdAt instanceof Date) {
    data.createdAt = data.createdAt.toISOString();
  }

  if (data.updatedAt instanceof Date) {
    data.updatedAt = data.updatedAt.toISOString();
  }

  if (data.registrationDeadline instanceof Date) {
    data.registrationDeadline = data.registrationDeadline.toISOString();
  }

  return data;
};

/* =========================================================
   FIND EVENT BY ID
========================================================= */

const findEventById = async (reunionEvents, eventId) => {
  if (!reunionEvents || !eventId) {
    return null;
  }

  /*
    Try ObjectId first.
  */

  const objectId = normalizeObjectId(eventId);

  if (objectId) {
    const byObjectId = await reunionEvents.findOne({
      _id: objectId,
    });

    if (byObjectId) {
      return byObjectId;
    }
  }

  /*
    Also support string _id.

    This makes the API tolerant if an
    existing event was stored with a string ID.
  */

  const stringId = cleanString(eventId);

  if (stringId) {
    const byStringId = await reunionEvents.findOne({
      _id: stringId,
    });

    if (byStringId) {
      return byStringId;
    }
  }

  return null;
};

/* =========================================================
   ACTIVE EVENT QUERY
========================================================= */

const ACTIVE_EVENT_QUERY = {
  status: {
    $in: ["published", "active"],
  },

  registrationOpen: true,
};

/* =========================================================
   ROUTE: TEST
========================================================= */

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Reunion events route is working.",
    route: "/api/reunion-events/test",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   ROUTE: GET ACTIVE EVENT
   GET /api/reunion-events/active
========================================================= */

router.get("/active", async (req, res) => {
  try {
    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const event = await reunionEvents.findOne(ACTIVE_EVENT_QUERY, {
      sort: {
        eventDate: 1,
        createdAt: -1,
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "No active reunion event found.",
        code: "event/not-found",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeEvent(event),
    });
  } catch (error) {
    console.error("GET /api/reunion-events/active error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load active reunion event.",
      code: "event/active-load-failed",
    });
  }
});

/* =========================================================
   ROUTE: GET ALL EVENTS
   GET /api/reunion-events
========================================================= */

router.get("/", async (req, res) => {
  try {
    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const events = await reunionEvents
      .find({})
      .sort({
        eventDate: -1,
        createdAt: -1,
      })
      .toArray();

    return res.status(200).json({
      success: true,
      count: events.length,
      data: events.map(serializeEvent),
    });
  } catch (error) {
    console.error("GET /api/reunion-events error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reunion events.",
      code: "event/list-failed",
    });
  }
});

/* =========================================================
   ROUTE: GET EVENT BY ID
   GET /api/reunion-events/:eventId
========================================================= */

router.get("/:eventId", async (req, res) => {
  try {
    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const eventId = cleanString(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "Event ID is required.",
        code: "validation/event-id-required",
      });
    }

    const event = await findEventById(reunionEvents, eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Reunion event not found.",
        code: "event/not-found",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeEvent(event),
    });
  } catch (error) {
    console.error("GET /api/reunion-events/:eventId error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reunion event.",
      code: "event/get-failed",
    });
  }
});

/* =========================================================
   ROUTE: CREATE EVENT
   POST /api/reunion-events

   ADMIN ONLY
========================================================= */

router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const eventData = normalizeEventData(req.body);

    const validationErrors = validateEventData(eventData);

    if (validationErrors.length) {
      return res.status(400).json({
        success: false,
        message: "Event validation failed.",
        code: "validation/event-invalid",
        errors: validationErrors,
      });
    }

    /*
        Only one event can be active
        for registration at a time.
      */

    if (
      eventData.registrationOpen === true &&
      (eventData.status === "published" || eventData.status === "active")
    ) {
      const existingActiveEvent =
        await reunionEvents.findOne(ACTIVE_EVENT_QUERY);

      if (existingActiveEvent) {
        return res.status(409).json({
          success: false,
          message: "Another reunion event is already active for registration.",
          code: "event/active-event-exists",

          existingEventId:
            existingActiveEvent._id instanceof ObjectId
              ? existingActiveEvent._id.toString()
              : String(existingActiveEvent._id),
        });
      }
    }

    /*
        Prevent duplicate slug.
      */

    if (eventData.slug) {
      const existingSlug = await reunionEvents.findOne({
        slug: eventData.slug,
      });

      if (existingSlug) {
        return res.status(409).json({
          success: false,
          message: "An event with this slug already exists.",
          code: "event/duplicate-slug",
        });
      }
    }

    const now = new Date();

    const document = {
      ...eventData,

      createdAt: now,

      updatedAt: now,

      createdBy: req.user?.uid || null,
    };

    const result = await reunionEvents.insertOne(document);

    const createdEvent = await reunionEvents.findOne({
      _id: result.insertedId,
    });

    return res.status(201).json({
      success: true,
      message: "Reunion event created successfully.",

      data: serializeEvent(createdEvent),
    });
  } catch (error) {
    console.error("POST /api/reunion-events error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An event with the same unique field already exists.",
        code: "event/duplicate",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create reunion event.",
      code: "event/create-failed",
    });
  }
});

/* =========================================================
   ROUTE: UPDATE EVENT
   PATCH /api/reunion-events/:eventId

   ADMIN ONLY
========================================================= */

router.patch("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const eventId = cleanString(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "Event ID is required.",
        code: "validation/event-id-required",
      });
    }

    const existingEvent = await findEventById(reunionEvents, eventId);

    if (!existingEvent) {
      return res.status(404).json({
        success: false,
        message: "Reunion event not found.",
        code: "event/not-found",
      });
    }

    /*
        Merge current document with
        requested update.
      */

    const eventData = normalizeEventData(req.body, existingEvent);

    const validationErrors = validateEventData(eventData);

    if (validationErrors.length) {
      return res.status(400).json({
        success: false,
        message: "Event validation failed.",
        code: "validation/event-invalid",
        errors: validationErrors,
      });
    }

    /*
        Prevent duplicate slug.
      */

    if (eventData.slug) {
      const duplicateSlug = await reunionEvents.findOne({
        slug: eventData.slug,

        _id: {
          $ne: existingEvent._id,
        },
      });

      if (duplicateSlug) {
        return res.status(409).json({
          success: false,
          message: "Another event already uses this slug.",
          code: "event/duplicate-slug",
        });
      }
    }

    /*
        If this event is being made active,
        check for another active event.
      */

    const isBecomingActive =
      eventData.registrationOpen === true &&
      (eventData.status === "published" || eventData.status === "active");

    if (isBecomingActive) {
      const anotherActiveEvent = await reunionEvents.findOne({
        ...ACTIVE_EVENT_QUERY,

        _id: {
          $ne: existingEvent._id,
        },
      });

      if (anotherActiveEvent) {
        return res.status(409).json({
          success: false,
          message: "Another reunion event is already active for registration.",
          code: "event/active-event-exists",

          existingEventId:
            anotherActiveEvent._id instanceof ObjectId
              ? anotherActiveEvent._id.toString()
              : String(anotherActiveEvent._id),
        });
      }
    }

    const now = new Date();

    const updateData = {
      ...eventData,

      updatedAt: now,

      updatedBy: req.user?.uid || null,
    };

    const updateResult = await reunionEvents.updateOne(
      {
        _id: existingEvent._id,
      },
      {
        $set: updateData,
      },
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Reunion event not found.",
        code: "event/not-found",
      });
    }

    const updatedEvent = await reunionEvents.findOne({
      _id: existingEvent._id,
    });

    return res.status(200).json({
      success: true,
      message: "Reunion event updated successfully.",

      data: serializeEvent(updatedEvent),
    });
  } catch (error) {
    console.error("PATCH /api/reunion-events/:eventId error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An event with the same unique field already exists.",
        code: "event/duplicate",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update reunion event.",
      code: "event/update-failed",
    });
  }
});

/* =========================================================
   ROUTE: DELETE EVENT
   DELETE /api/reunion-events/:eventId

   ADMIN ONLY
========================================================= */

router.delete("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { reunionEvents, registrations } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        message: "Reunion events collection is not available.",
        code: "database/event-collection-not-found",
      });
    }

    const eventId = cleanString(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "Event ID is required.",
        code: "validation/event-id-required",
      });
    }

    const event = await findEventById(reunionEvents, eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Reunion event not found.",
        code: "event/not-found",
      });
    }

    /*
        Do not delete an event that already
        has registrations.

        Current registration schema:

        reunion.eventId
      */

    if (registrations) {
      let registrationCount = 0;

      /*
          Most current events use ObjectId.
        */

      if (event._id instanceof ObjectId) {
        registrationCount = await registrations.countDocuments({
          "reunion.eventId": event._id,
        });
      } else {
        /*
            Support string event IDs as well.
          */

        registrationCount = await registrations.countDocuments({
          $or: [
            {
              "reunion.eventId": event._id,
            },

            ...(isValidObjectId(event._id)
              ? [
                  {
                    "reunion.eventId": normalizeObjectId(event._id),
                  },
                ]
              : []),
          ],
        });
      }

      if (registrationCount > 0) {
        return res.status(409).json({
          success: false,
          message:
            "This event cannot be deleted because registrations already exist for it.",
          code: "event/has-registrations",

          registrationCount,
        });
      }
    }

    const result = await reunionEvents.deleteOne({
      _id: event._id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Reunion event was not deleted.",
        code: "event/delete-failed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reunion event deleted successfully.",

      eventId:
        event._id instanceof ObjectId
          ? event._id.toString()
          : String(event._id),
    });
  } catch (error) {
    console.error("DELETE /api/reunion-events/:eventId error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete reunion event.",
      code: "event/delete-failed",
    });
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;
