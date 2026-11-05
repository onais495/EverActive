const prisma = require('../db');
const eventbrite = require('./eventbrite');
const { METRO_AREAS } = require('../constants');

// Only cache what plans can use; plans look at most 7 days ahead
const SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX_LENGTH = 1000;

function isInBounds(lat, lng, bounds) {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

// Turns an Eventbrite event into our Event fields, or null if it should be skipped
function toCachedEvent(raw, source, now) {
  const metro = METRO_AREAS[source.metroArea];
  const address = raw.venue && raw.venue.address;
  if (raw.online_event || !address || !metro) return null;
  // A venue can host anything; when the source names an organizer, keep only their events
  if (source.eventbriteOrganizerId && String(raw.organizer_id) !== source.eventbriteOrganizerId) return null;

  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInBounds(lat, lng, metro.bounds)) return null;

  const startsAt = new Date(raw.start && raw.start.utc);
  if (Number.isNaN(startsAt.getTime()) || startsAt < now || startsAt - now > SYNC_WINDOW_MS) return null;

  const description = (raw.summary || (raw.description && raw.description.text) || '').trim();

  return {
    eventbriteId: String(raw.id),
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
    metroArea: source.metroArea,
  };
}

async function syncSource(source, now = new Date()) {
  const rawEvents = await eventbrite.listVenueEvents(source.eventbriteVenueId);
  let saved = 0;

  for (const raw of rawEvents) {
    const event = toCachedEvent(raw, source, now);
    if (!event) continue;
    await prisma.event.upsert({
      where: { eventbriteId: event.eventbriteId },
      create: event,
      update: event,
    });
    saved++;
  }

  await prisma.eventSource.update({ where: { id: source.id }, data: { lastSyncedAt: now } });
  return { fetched: rawEvents.length, saved };
}

// One failing source (bad ID, Eventbrite hiccup) never stops the others
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

  return results;
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

module.exports = { runSync, syncAllSources, syncSource, toCachedEvent };
