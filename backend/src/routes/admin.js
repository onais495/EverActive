const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateEventSource } = require('../validation');
const eventbrite = require('../services/eventbrite');
const { runSync } = require('../services/eventSync');
const { ACTIVITY_TYPES } = require('../constants');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/admin/event-sources: the curated Eventbrite venues
router.get('/event-sources', async (req, res) => {
  const sources = await prisma.eventSource.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ sources });
});

// POST /api/admin/event-sources: add a source by pasting any event ID (the number at the end of
// an Eventbrite event URL). We store that event's venue and organizer, so syncs pick up that
// organizer's events at that venue. Passing venueId instead takes every public event at the venue.
router.post('/event-sources', async (req, res) => {
  const { errors, data } = validateEventSource(req.body || {});
  if (errors) return res.status(400).json({ message: errors[0], errors });

  let venueId = data.venueId;
  let organizerId = null;
  if (data.eventId) {
    let event;
    try {
      event = await eventbrite.getEvent(data.eventId);
    } catch (err) {
      console.warn('Eventbrite lookup failed:', err.message);
      return res.status(400).json({ message: 'Couldn’t find that event on Eventbrite. Check the event ID.' });
    }
    if (event.online_event || !event.venue_id) {
      return res.status(400).json({ message: 'That event is online-only, so it has no venue to follow.' });
    }
    venueId = String(event.venue_id);
    organizerId = event.organizer_id ? String(event.organizer_id) : null;
  }

  try {
    const source = await prisma.eventSource.create({
      data: {
        name: data.name,
        defaultCategory: data.defaultCategory,
        eventbriteVenueId: venueId,
        eventbriteOrganizerId: organizerId,
      },
    });
    res.status(201).json({ source });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ message: 'That venue and organizer are already a source.' });
    throw err;
  }
});

// PATCH /api/admin/event-sources/:id: pause a source or change its category
router.patch('/event-sources/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ message: 'Source not found.' });
  const { isActive, defaultCategory } = req.body || {};
  const data = {};
  if (typeof isActive === 'boolean') data.isActive = isActive;
  if (ACTIVITY_TYPES.includes(defaultCategory)) data.defaultCategory = defaultCategory;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Send isActive (true/false) or a valid defaultCategory.' });
  }

  const { count } = await prisma.eventSource.updateMany({ where: { id }, data });
  if (count === 0) return res.status(404).json({ message: 'Source not found.' });
  res.json({ source: await prisma.eventSource.findFirst({ where: { id } }) });
});

// POST /api/admin/event-sync: pull events now instead of waiting for the daily job
router.post('/event-sync', async (req, res) => {
  const results = await runSync();
  if (!results) return res.status(409).json({ message: 'A sync is already running. Try again in a minute.' });
  res.json({ results });
});

module.exports = router;
