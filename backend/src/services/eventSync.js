const prisma = require('../db');
const eventbrite = require('./eventbrite');
const luma = require('./luma');
const { screenPendingEvents } = require('./screening');
const { METRO_AREAS } = require('../constants');

// Only cache what plans can use; plans look at most 7 days ahead
const SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX_LENGTH = 1000;

function isInBounds(lat, lng, bounds) {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function isInWindow(startsAt, now) {
  return startsAt instanceof Date && !Number.isNaN(startsAt.getTime()) && startsAt >= now && startsAt - now <= SYNC_WINDOW_MS;
}

// Turns an Eventbrite event into our Event fields, or null if it should be skipped
function toCachedEvent(raw, source, now) {
  const metro = METRO_AREAS[source.metroArea];
  const address = raw.venue && raw.venue.address;
  if (raw.online_event || !address || !metro) return null;
  // A venue can host anything; when the source names an organizer, keep only their events
  if (source.organizerId && String(raw.organizer_id) !== source.organizerId) return null;

  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInBounds(lat, lng, metro.bounds)) return null;

  const startsAt = new Date(raw.start && raw.start.utc);
  if (!isInWindow(startsAt, now)) return null;

  const description = (raw.summary || (raw.description && raw.description.text) || '').trim();

  return {
    provider: 'EVENTBRITE',
    externalId: String(raw.id),
    sourceId: source.id,
    title: ((raw.name && raw.name.text) || 'Untitled event').trim().slice(0, 200),
    description: description.slice(0, DESCRIPTION_MAX_LENGTH),
    url: raw.url || null,
    startsAt,
    endsAt: raw.end && raw.end.utc ? new Date(raw.end.utc) : null,
    venueName: raw.venue.name || null,
    address: address.localized_address_display || null,
    latitude: lat,
    longitude: lng,
    isFree: Boolean(raw.is_free),
    category: source.defaultCategory,
    // The organizer's own category, e.g. "Music"; the source's is the fallback for uncategorized events
    eventCategory: (raw.category && raw.category.name) || source.defaultEventCategory || null,
    metroArea: source.metroArea,
  };
}

const HIDDEN_ADDRESS = 'Check event page for more details.';

// Luma's feed packs extra details into DESCRIPTION:
//   "Get up-to-date information at: <url>\n\nAddress:\n<lines>\n\n<description>\n\nHosted by <names>"
function splitLumaDescription(text) {
  const url = (/Get up-to-date information at: (\S+)/.exec(text) || [])[1] || null;
  const addressLines = ((/Address:\n([\s\S]*?)(?:\n\n|$)/.exec(text) || [])[1] || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== HIDDEN_ADDRESS);
  const hostedBy = (/\n\n(Hosted by [^\n]+)\s*$/.exec(text) || [])[1] || null;

  const body = text
    .replace(/^Get up-to-date information at: \S+\s*/, '')
    .replace(/^Address:\n[\s\S]*?(?:\n\n|$)/, '')
    .replace(/\n\nHosted by [^\n]+\s*$/, '')
    .replace(/^Hosted by [^\n]+\s*$/, '')
    .trim();

  return { url, venueName: addressLines[0] || null, hostedBy, body };
}

// Turns one Luma iCal event into our Event fields, or null if it should be skipped
function toCachedLumaEvent(raw, source, now) {
  const metro = METRO_AREAS[source.metroArea];
  if (!metro || !raw.uid || !raw.summary || raw.status === 'CANCELLED') return null;
  // No coordinates means an online event or a hidden location we can't place in the city
  if (!raw.geo || !isInBounds(raw.geo.lat, raw.geo.lng, metro.bounds)) return null;
  if (!isInWindow(raw.start, now)) return null;

  const { url, venueName, hostedBy, body } = splitLumaDescription(raw.description || '');
  // LOCATION is the street address, or the event's link when the host hides the address
  const location = raw.location && !/^https?:\/\//.test(raw.location) ? raw.location.trim() : null;
  const eventId = raw.uid.split('@')[0];

  return {
    provider: 'LUMA',
    externalId: eventId.slice(0, 50),
    sourceId: source.id,
    title: raw.summary.trim().slice(0, 200),
    description: (body || hostedBy || '').slice(0, DESCRIPTION_MAX_LENGTH),
    url: url || `https://luma.com/event/${encodeURIComponent(eventId)}`,
    startsAt: raw.start,
    endsAt: raw.end || null,
    venueName: (venueName || (location && location.split(',')[0]) || null)?.slice(0, 200) ?? null,
    address: location ? location.slice(0, 300) : null,
    latitude: raw.geo.lat,
    longitude: raw.geo.lng,
    // The feed doesn't include ticket prices
    isFree: null,
    category: source.defaultCategory,
    eventCategory: source.defaultEventCategory || null,
    metroArea: source.metroArea,
  };
}

async function fetchSourceEvents(source, now) {
  if (source.provider === 'LUMA') {
    const raw = await luma.listCalendarEvents(source.externalId);
    return { fetched: raw.length, events: raw.map((r) => toCachedLumaEvent(r, source, now)).filter(Boolean) };
  }
  const raw = await eventbrite.listVenueEvents(source.externalId);
  return { fetched: raw.length, events: raw.map((r) => toCachedEvent(r, source, now)).filter(Boolean) };
}

async function syncSource(source, now = new Date()) {
  const { fetched, events } = await fetchSourceEvents(source, now);

  for (const event of events) {
    // Screened sources: new events wait for the AI (isSuitable null), and a re-sync refreshes the
    // details but never overwrites the AI's (or an admin's) decision, the categories, or the source.
    // The same event can also come from a hand-picked calendar, which wins: it owns the event and
    // vouches for it.
    const { category, eventCategory, sourceId, ...details } = event;
    await prisma.event.upsert({
      where: { provider_externalId: { provider: event.provider, externalId: event.externalId } },
      create: source.aiScreened ? { ...event, isSuitable: null } : { ...event, isSuitable: true },
      update: source.aiScreened ? details : { ...event, isSuitable: true },
    });
  }

  await prisma.eventSource.update({ where: { id: source.id }, data: { lastSyncedAt: now } });
  return { fetched, saved: events.length };
}

// One failing source (bad ID, provider hiccup) never stops the others
async function syncAllSources() {
  const sources = await prisma.eventSource.findMany({ where: { isActive: true } });
  const results = [];

  for (const source of sources) {
    try {
      results.push({ sourceId: source.id, name: source.name, ...(await syncSource(source)) });
    } catch (err) {
      console.error(`Event sync failed for source ${source.id} (${source.name}):`, err.message);
      results.push({ sourceId: source.id, name: source.name, error: err.message });
    }
  }

  // Only screens when something needs it, so syncs with no screened sources never call Gemini
  let screening = null;
  if (sources.some((s) => s.aiScreened)) {
    try {
      screening = await screenPendingEvents();
    } catch (err) {
      console.error('Event screening failed:', err.message);
      screening = { error: err.message };
    }
  }

  return { results, screening };
}

// The daily job and the admin "sync now" button share this, so two syncs never overlap
let syncInProgress = false;

async function runSync() {
  if (syncInProgress) return null;
  syncInProgress = true;
  try {
    return await syncAllSources();
  } finally {
    syncInProgress = false;
  }
}

module.exports = { runSync, syncAllSources, syncSource, toCachedEvent, toCachedLumaEvent, splitLumaDescription };
