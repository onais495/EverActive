const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateEventSource, validateEventSourceUpdate } = require('../validation');
const eventbrite = require('../services/eventbrite');
const luma = require('../services/luma');
const { runSync } = require('../services/eventSync');
const { getAdminStats } = require('../services/stats');
const { runNudges } = require('../services/nudges');
const { destroyUserSessions } = require('../services/sessions');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// GET /api/admin/stats: grouped numbers for the Admin Dashboard. Never lists or identifies users.
router.get('/stats', async (req, res) => {
  res.json(await getAdminStats());
});

// GET /api/admin/users?page=1 (US011): account management. Names and emails only: never interests,
// plans or activity history (SRS 4.2).
const USERS_PER_PAGE = 50;
router.get('/users', async (req, res) => {
  const page = Math.max(1, parseId(req.query.page) || 1);
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * USERS_PER_PAGE,
      take: USERS_PER_PAGE,
      select: { id: true, nameFirst: true, nameLast: true, email: true, role: true, isActive: true, createdAt: true },
    }),
    prisma.user.count(),
  ]);
  res.json({ users, page, pageSize: USERS_PER_PAGE, total });
});

// PATCH /api/admin/users/:id { isActive: false } (US011): deactivate (or reactivate) an account.
// Deactivating logs the user out everywhere; nothing is deleted.
router.patch('/users/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { isActive } = req.body || {};
  if (!id) return res.status(404).json({ message: 'User not found.' });
  if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'Send isActive: true or false.' });
  if (id === req.user.id && !isActive) return res.status(400).json({ message: 'You can’t deactivate your own account.' });

  const { count } = await prisma.user.updateMany({ where: { id }, data: { isActive } });
  if (count === 0) return res.status(404).json({ message: 'User not found.' });
  if (!isActive) await destroyUserSessions(id);
  res.json({ message: isActive ? 'Account reactivated.' : 'Account deactivated and logged out.' });
});

// POST /api/admin/nudges/run: send today's reminders now instead of waiting for the daily job
router.post('/nudges/run', async (req, res) => {
  res.json({ summary: await runNudges() });
});

// GET /api/admin/event-sources: the curated Eventbrite venues and Luma calendars
router.get('/event-sources', async (req, res) => {
  const sources = await prisma.eventSource.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ sources });
});

// Eventbrite: look up a sample event to find its venue and organizer, so syncs pick up that
// organizer's events at that venue. Passing venueId instead takes every public event at the venue.
async function resolveEventbrite(data) {
  if (!data.eventId) return { externalId: data.venueId, organizerId: null };
  let event;
  try {
    event = await eventbrite.getEvent(data.eventId);
  } catch (err) {
    console.warn('Eventbrite lookup failed:', err.message);
    return { error: 'Couldn’t find that event on Eventbrite. Check the event ID.' };
  }
  if (event.online_event || !event.venue_id) {
    return { error: 'That event is online-only, so it has no venue to follow.' };
  }
  return { externalId: String(event.venue_id), organizerId: event.organizer_id ? String(event.organizer_id) : null };
}

// Luma: fetch the feed once so a typo is caught now rather than at the next sync.
// A whole-city feed is always AI-screened; a hand-picked calendar is screened only if asked.
async function resolveLuma(data) {
  try {
    await luma.listCalendarEvents(data.calendarId);
  } catch (err) {
    console.warn('Luma lookup failed:', err.message);
    return { error: 'Couldn’t load that Luma calendar. Check the calendar ID or iCal link.' };
  }
  return { externalId: data.calendarId, organizerId: null, aiScreened: data.aiScreened || luma.isCityFeed(data.calendarId) };
}

// POST /api/admin/event-sources: add a source (see validateEventSource for the body)
router.post('/event-sources', async (req, res) => {
  const { errors, data } = validateEventSource(req.body || {});
  if (errors) return res.status(400).json({ message: errors[0], errors });

  const resolved = data.provider === 'LUMA' ? await resolveLuma(data) : await resolveEventbrite(data);
  if (resolved.error) return res.status(400).json({ message: resolved.error });

  // MySQL unique indexes treat NULLs as distinct, so check for a duplicate explicitly
  const existing = await prisma.eventSource.findFirst({
    where: { provider: data.provider, externalId: resolved.externalId, organizerId: resolved.organizerId },
  });
  if (existing) return res.status(409).json({ message: 'That source has already been added.' });

  const source = await prisma.eventSource.create({
    data: {
      name: data.name,
      provider: data.provider,
      externalId: resolved.externalId,
      organizerId: resolved.organizerId,
      defaultCategory: data.defaultCategory,
      defaultEventCategory: data.defaultEventCategory,
      aiScreened: Boolean(resolved.aiScreened || data.aiScreened),
    },
  });
  res.status(201).json({ source });
});

// PATCH /api/admin/event-sources/:id: pause a source or change its categories
router.patch('/event-sources/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ message: 'Source not found.' });
  const { errors, data } = validateEventSourceUpdate(req.body || {});
  if (errors) return res.status(400).json({ message: errors[0], errors });

  const { count } = await prisma.eventSource.updateMany({ where: { id }, data });
  if (count === 0) return res.status(404).json({ message: 'Source not found.' });
  res.json({ source: await prisma.eventSource.findFirst({ where: { id } }) });
});

// POST /api/admin/event-sync: pull events now instead of waiting for the daily job
router.post('/event-sync', async (req, res) => {
  const outcome = await runSync();
  if (!outcome) return res.status(409).json({ message: 'A sync is already running. Try again in a minute.' });
  res.json(outcome);
});

const VERDICTS = { approved: true, rejected: false, pending: null };

// GET /api/admin/screened-events?verdict=rejected|approved|pending: upcoming events from AI-screened
// sources, to check the AI's decisions. Defaults to rejected, the ones worth a second look.
router.get('/screened-events', async (req, res) => {
  const verdict = req.query.verdict || 'rejected';
  if (!Object.hasOwn(VERDICTS, verdict)) {
    return res.status(400).json({ message: 'verdict must be approved, rejected or pending.' });
  }
  const sources = await prisma.eventSource.findMany({ where: { aiScreened: true }, select: { id: true } });
  const events = await prisma.event.findMany({
    where: { sourceId: { in: sources.map((s) => s.id) }, isSuitable: VERDICTS[verdict], startsAt: { gte: new Date() } },
    orderBy: { startsAt: 'asc' },
    take: 100,
  });
  res.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      url: e.url,
      category: e.category,
      eventCategory: e.eventCategory,
      isSuitable: e.isSuitable,
      screenedAt: e.screenedAt,
    })),
  });
});

// PATCH /api/admin/events/:id { isSuitable: true|false }: override the AI for one event
router.patch('/events/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { isSuitable } = req.body || {};
  if (!id) return res.status(404).json({ message: 'Event not found.' });
  if (typeof isSuitable !== 'boolean') return res.status(400).json({ message: 'Send isSuitable: true or false.' });

  const { count } = await prisma.event.updateMany({ where: { id }, data: { isSuitable, screenedAt: new Date() } });
  if (count === 0) return res.status(404).json({ message: 'Event not found.' });
  res.json({ message: isSuitable ? 'This event can now appear in plans.' : 'This event won’t appear in plans.' });
});

module.exports = router;
