import express from "express";
import { ObjectId } from "mongodb";

import { connectDB, getCollections } from "../config/db.js";
import verifyToken from "../middleware/verifyToken.js";
import verifyAdmin from "../middleware/verifyAdmin.js";

const router = express.Router();

// ============================================================
// CONSTANTS
// ============================================================

const MAX_TITLE_LENGTH = 150;
const MAX_SHORT_TITLE_LENGTH = 100;
const MAX_EDITION_LENGTH = 100;
const MAX_VENUE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const normalizeString = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
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

const isValidObjectId = (value) => {
  return ObjectId.isValid(value);
};

const serializeDocument = (document) => {
  if (!document) {
    return null;
  }

  return {
    ...document,
    _id: document._id?.toString(),
  };
};

const getAuthenticatedUid = (req) => {
  return normalizeString(req.user?.uid || req.userData?.uid);
};

const getAuthenticatedEmail = (req) => {
  return normalizeString(req.user?.email || req.userData?.email).toLowerCase();
};

// ============================================================
// EVENT VALIDATION
// ============================================================

const validateEventPayload = ({
  title,
  shortTitle,
  edition,
  eventDate,
  startTime,
  endTime,
  venue,
  registrationDeadline,
  description,
}) => {
  const errors = {};

  // ----------------------------------------------------------
  // TITLE
  // ----------------------------------------------------------

  if (!title) {
    errors.title = "Event title is required.";
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Event title cannot exceed ${MAX_TITLE_LENGTH} characters.`;
  }

  // ----------------------------------------------------------
  // SHORT TITLE
  // ----------------------------------------------------------

  if (shortTitle && shortTitle.length > MAX_SHORT_TITLE_LENGTH) {
    errors.shortTitle = `Short title cannot exceed ${MAX_SHORT_TITLE_LENGTH} characters.`;
  }

  // ----------------------------------------------------------
  // EDITION
  // ----------------------------------------------------------

  if (edition && edition.length > MAX_EDITION_LENGTH) {
    errors.edition = `Edition cannot exceed ${MAX_EDITION_LENGTH} characters.`;
  }

  // ----------------------------------------------------------
  // EVENT DATE
  // ----------------------------------------------------------

  if (!eventDate) {
    errors.eventDate = "Event date is required.";
  }

  // ----------------------------------------------------------
  // START TIME
  // ----------------------------------------------------------

  if (!startTime) {
    errors.startTime = "Start time is required.";
  } else if (!TIME_REGEX.test(startTime)) {
    errors.startTime = "Start time must use HH:mm format.";
  }

  // ----------------------------------------------------------
  // END TIME
  // ----------------------------------------------------------

  if (!endTime) {
    errors.endTime = "End time is required.";
  } else if (!TIME_REGEX.test(endTime)) {
    errors.endTime = "End time must use HH:mm format.";
  }

  // ----------------------------------------------------------
  // TIME RANGE
  // ----------------------------------------------------------

  if (
    startTime &&
    endTime &&
    TIME_REGEX.test(startTime) &&
    TIME_REGEX.test(endTime) &&
    startTime >= endTime
  ) {
    errors.endTime = "End time must be later than start time.";
  }

  // ----------------------------------------------------------
  // VENUE
  // ----------------------------------------------------------

  if (!venue) {
    errors.venue = "Venue is required.";
  } else if (venue.length > MAX_VENUE_LENGTH) {
    errors.venue = `Venue cannot exceed ${MAX_VENUE_LENGTH} characters.`;
  }

  // ----------------------------------------------------------
  // REGISTRATION DEADLINE
  // ----------------------------------------------------------

  if (registrationDeadline) {
    const deadline = new Date(registrationDeadline);

    if (Number.isNaN(deadline.getTime())) {
      errors.registrationDeadline =
        "Registration deadline must be a valid date.";
    }
  }

  // ----------------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------------

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  return errors;
};

// ============================================================
// ROUTE TEST
// GET /api/reunion-events/test
// ============================================================

router.get("/test", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Reunion events route is working.",
    route: "/api/reunion-events/test",
  });
});

// ============================================================
// GET ACTIVE REUNION EVENT
// GET /api/reunion-events/active
// ============================================================

router.get("/active", async (req, res) => {
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

// ============================================================
// GET ALL REUNION EVENTS
// GET /api/reunion-events
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
      data: events.map(serializeDocument),
    });
  } catch (error) {
    console.error("GET REUNION EVENTS ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/events-load-failed",
      message: "Failed to load reunion events.",
    });
  }
});

// ============================================================
// GET REUNION EVENT BY ID
// GET /api/reunion-events/:eventId
// ============================================================

router.get("/:eventId", async (req, res) => {
  try {
    const eventId = normalizeString(req.params.eventId);

    if (!eventId || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id",
        message: "Invalid reunion event ID.",
      });
    }

    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

    const event = await reunionEvents.findOne({
      _id: new ObjectId(eventId),
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
    console.error("GET REUNION EVENT BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-load-failed",
      message: "Failed to load reunion event.",
    });
  }
});

// ============================================================
// CREATE REUNION EVENT
// POST /api/reunion-events
// ADMIN ONLY
// ============================================================

router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const uid = getAuthenticatedUid(req);
    const adminEmail = getAuthenticatedEmail(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    const {
      title,
      shortTitle,
      edition,
      eventDate,
      startTime,
      endTime,
      venue,
      registrationOpen,
      registrationDeadline,
      paymentRequired,
      description,
    } = req.body || {};

    const normalizedTitle = normalizeString(title);
    const normalizedShortTitle = normalizeString(shortTitle);
    const normalizedEdition = normalizeString(edition);
    const normalizedVenue = normalizeString(venue);
    const normalizedDescription = normalizeString(description);

    const normalizedEventDate = normalizeDate(eventDate);
    const normalizedRegistrationDeadline = normalizeDate(registrationDeadline);

    const normalizedStartTime = normalizeString(startTime);
    const normalizedEndTime = normalizeString(endTime);

    const normalizedRegistrationOpen =
      typeof registrationOpen === "boolean" ? registrationOpen : false;

    const normalizedPaymentRequired =
      typeof paymentRequired === "boolean" ? paymentRequired : false;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    const validationErrors = validateEventPayload({
      title: normalizedTitle,
      shortTitle: normalizedShortTitle,
      edition: normalizedEdition,
      eventDate: normalizedEventDate,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      venue: normalizedVenue,
      registrationDeadline: normalizedRegistrationDeadline,
      description: normalizedDescription,
    });

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({
        success: false,
        code: "validation/event",
        message: "Please correct the event information.",
        errors: validationErrors,
      });
    }

    // --------------------------------------------------------
    // DATABASE
    // --------------------------------------------------------

    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

    // --------------------------------------------------------
    // ONLY ONE ACTIVE EVENT
    // --------------------------------------------------------

    if (normalizedRegistrationOpen) {
      const existingActiveEvent = await reunionEvents.findOne({
        registrationOpen: true,
      });

      if (existingActiveEvent) {
        return res.status(409).json({
          success: false,
          code: "reunion/active-event-exists",
          message: "Another reunion event is already open for registration.",
          data: {
            eventId: existingActiveEvent._id?.toString() || null,
            title: existingActiveEvent.title || null,
          },
        });
      }
    }

    // --------------------------------------------------------
    // CREATE DOCUMENT
    // --------------------------------------------------------

    const now = new Date();

    const eventDocument = {
      title: normalizedTitle,

      shortTitle: normalizedShortTitle || null,

      edition: normalizedEdition || null,

      eventDate: normalizedEventDate,

      startTime: normalizedStartTime,

      endTime: normalizedEndTime,

      venue: normalizedVenue,

      registrationOpen: normalizedRegistrationOpen,

      registrationDeadline: normalizedRegistrationDeadline,

      paymentRequired: normalizedPaymentRequired,

      description: normalizedDescription || null,

      createdBy: {
        uid,
        email: adminEmail || null,
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
    console.error("CREATE REUNION EVENT ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-create-failed",
      message: "Failed to create reunion event.",
    });
  }
});

// ============================================================
// UPDATE REUNION EVENT
// PATCH /api/reunion-events/:eventId
// ADMIN ONLY
// ============================================================

router.patch("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    const eventId = normalizeString(req.params.eventId);

    if (!eventId || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id",
        message: "Invalid reunion event ID.",
      });
    }

    await connectDB();

    const { reunionEvents } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

    const objectId = new ObjectId(eventId);

    const existingEvent = await reunionEvents.findOne({
      _id: objectId,
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
    // TITLE
    // --------------------------------------------------------

    if (body.title !== undefined) {
      const title = normalizeString(body.title);

      if (!title) {
        return res.status(400).json({
          success: false,
          code: "validation/title",
          message: "Event title cannot be empty.",
        });
      }

      if (title.length > MAX_TITLE_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/title",
          message: `Event title cannot exceed ${MAX_TITLE_LENGTH} characters.`,
        });
      }

      update.title = title;
    }

    // --------------------------------------------------------
    // SHORT TITLE
    // --------------------------------------------------------

    if (body.shortTitle !== undefined) {
      const shortTitle = normalizeString(body.shortTitle);

      if (shortTitle.length > MAX_SHORT_TITLE_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/short-title",
          message: `Short title cannot exceed ${MAX_SHORT_TITLE_LENGTH} characters.`,
        });
      }

      update.shortTitle = shortTitle || null;
    }

    // --------------------------------------------------------
    // EDITION
    // --------------------------------------------------------

    if (body.edition !== undefined) {
      const edition = normalizeString(body.edition);

      if (edition.length > MAX_EDITION_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/edition",
          message: `Edition cannot exceed ${MAX_EDITION_LENGTH} characters.`,
        });
      }

      update.edition = edition || null;
    }

    // --------------------------------------------------------
    // EVENT DATE
    // --------------------------------------------------------

    if (body.eventDate !== undefined) {
      const eventDate = normalizeDate(body.eventDate);

      if (!eventDate) {
        return res.status(400).json({
          success: false,
          code: "validation/event-date",
          message: "Invalid event date.",
        });
      }

      update.eventDate = eventDate;
    }

    // --------------------------------------------------------
    // START TIME
    // --------------------------------------------------------

    if (body.startTime !== undefined) {
      const startTime = normalizeString(body.startTime);

      if (!TIME_REGEX.test(startTime)) {
        return res.status(400).json({
          success: false,
          code: "validation/start-time",
          message: "Start time must use HH:mm format.",
        });
      }

      update.startTime = startTime;
    }

    // --------------------------------------------------------
    // END TIME
    // --------------------------------------------------------

    if (body.endTime !== undefined) {
      const endTime = normalizeString(body.endTime);

      if (!TIME_REGEX.test(endTime)) {
        return res.status(400).json({
          success: false,
          code: "validation/end-time",
          message: "End time must use HH:mm format.",
        });
      }

      update.endTime = endTime;
    }

    // --------------------------------------------------------
    // TIME RANGE
    // --------------------------------------------------------

    const finalStartTime = update.startTime ?? existingEvent.startTime;

    const finalEndTime = update.endTime ?? existingEvent.endTime;

    if (
      finalStartTime &&
      finalEndTime &&
      TIME_REGEX.test(finalStartTime) &&
      TIME_REGEX.test(finalEndTime) &&
      finalStartTime >= finalEndTime
    ) {
      return res.status(400).json({
        success: false,
        code: "validation/time-range",
        message: "End time must be later than start time.",
      });
    }

    // --------------------------------------------------------
    // VENUE
    // --------------------------------------------------------

    if (body.venue !== undefined) {
      const venue = normalizeString(body.venue);

      if (!venue) {
        return res.status(400).json({
          success: false,
          code: "validation/venue",
          message: "Venue cannot be empty.",
        });
      }

      if (venue.length > MAX_VENUE_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/venue",
          message: `Venue cannot exceed ${MAX_VENUE_LENGTH} characters.`,
        });
      }

      update.venue = venue;
    }

    // --------------------------------------------------------
    // REGISTRATION DEADLINE
    // --------------------------------------------------------

    if (body.registrationDeadline !== undefined) {
      if (
        body.registrationDeadline === null ||
        body.registrationDeadline === ""
      ) {
        update.registrationDeadline = null;
      } else {
        const deadline = normalizeDate(body.registrationDeadline);

        if (!deadline) {
          return res.status(400).json({
            success: false,
            code: "validation/registration-deadline",
            message: "Invalid registration deadline.",
          });
        }

        update.registrationDeadline = deadline;
      }
    }

    // --------------------------------------------------------
    // PAYMENT REQUIRED
    // --------------------------------------------------------

    if (body.paymentRequired !== undefined) {
      if (typeof body.paymentRequired !== "boolean") {
        return res.status(400).json({
          success: false,
          code: "validation/payment-required",
          message: "paymentRequired must be a boolean.",
        });
      }

      update.paymentRequired = body.paymentRequired;
    }

    // --------------------------------------------------------
    // DESCRIPTION
    // --------------------------------------------------------

    if (body.description !== undefined) {
      const description = normalizeString(body.description);

      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({
          success: false,
          code: "validation/description",
          message: `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
        });
      }

      update.description = description || null;
    }

    // --------------------------------------------------------
    // REGISTRATION OPEN
    // --------------------------------------------------------

    if (body.registrationOpen !== undefined) {
      if (typeof body.registrationOpen !== "boolean") {
        return res.status(400).json({
          success: false,
          code: "validation/registration-open",
          message: "registrationOpen must be a boolean.",
        });
      }

      if (body.registrationOpen === true) {
        const anotherActiveEvent = await reunionEvents.findOne({
          _id: {
            $ne: objectId,
          },
          registrationOpen: true,
        });

        if (anotherActiveEvent) {
          return res.status(409).json({
            success: false,
            code: "reunion/active-event-exists",
            message: "Another reunion event is already open for registration.",
            data: {
              eventId: anotherActiveEvent._id?.toString() || null,
              title: anotherActiveEvent.title || null,
            },
          });
        }
      }

      update.registrationOpen = body.registrationOpen;
    }

    // --------------------------------------------------------
    // NOTHING TO UPDATE
    // --------------------------------------------------------

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        code: "validation/no-update",
        message: "No valid event fields were provided for update.",
      });
    }

    // --------------------------------------------------------
    // UPDATED TIME
    // --------------------------------------------------------

    update.updatedAt = new Date();

    // --------------------------------------------------------
    // UPDATE DATABASE
    // --------------------------------------------------------

    await reunionEvents.updateOne(
      {
        _id: objectId,
      },
      {
        $set: update,
      },
    );

    const updatedEvent = await reunionEvents.findOne({
      _id: objectId,
    });

    return res.status(200).json({
      success: true,
      message: "Reunion event updated successfully.",
      data: serializeDocument(updatedEvent),
    });
  } catch (error) {
    console.error("UPDATE REUNION EVENT ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-update-failed",
      message: "Failed to update reunion event.",
    });
  }
});

// ============================================================
// DELETE REUNION EVENT
// DELETE /api/reunion-events/:eventId
// ADMIN ONLY
// ============================================================

router.delete("/:eventId", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const uid = getAuthenticatedUid(req);

    if (!uid) {
      return res.status(401).json({
        success: false,
        code: "auth/unauthorized",
        message: "Authentication is required.",
      });
    }

    const eventId = normalizeString(req.params.eventId);

    if (!eventId || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        code: "validation/event-id",
        message: "Invalid reunion event ID.",
      });
    }

    await connectDB();

    const { reunionEvents, reunionRegistrations } = getCollections();

    if (!reunionEvents) {
      return res.status(500).json({
        success: false,
        code: "database/collection-not-found",
        message: "Reunion events collection is unavailable.",
      });
    }

    const objectId = new ObjectId(eventId);

    const event = await reunionEvents.findOne({
      _id: objectId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        code: "reunion/event-not-found",
        message: "Reunion event was not found.",
      });
    }

    // --------------------------------------------------------
    // PREVENT DELETE IF REGISTRATIONS EXIST
    // --------------------------------------------------------

    if (reunionRegistrations) {
      const registrationCount = await reunionRegistrations.countDocuments({
        "reunion.eventId": objectId,
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
    }

    await reunionEvents.deleteOne({
      _id: objectId,
    });

    return res.status(200).json({
      success: true,
      message: "Reunion event deleted successfully.",
      data: {
        eventId,
      },
    });
  } catch (error) {
    console.error("DELETE REUNION EVENT ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "reunion/event-delete-failed",
      message: "Failed to delete reunion event.",
    });
  }
});

// ============================================================
// EXPORT
// ============================================================

export default router;
