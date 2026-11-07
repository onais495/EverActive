// Thin client for the Eventbrite endpoints that still exist after search was removed.
// Listing by organization only works for organizations you belong to (HTTP 403 otherwise),
// so sources are venues: listing a venue's public events works for anyone.
const BASE_URL = 'https://www.eventbriteapi.com/v3';
const REQUEST_TIMEOUT_MS = 10_000;
// Safety cap so one busy venue can't stall the sync
const MAX_PAGES = 10;

class EventbriteError extends Error {}

async function request(path, params = {}) {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) throw new EventbriteError('EVENTBRITE_TOKEN is not set.');

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new EventbriteError(`Eventbrite ${path} failed with HTTP ${res.status}`);
  }
  return res.json();
}

// Used once per new source: look up a sample event to find its venue and organizer
async function getEvent(eventId) {
  return request(`/events/${encodeURIComponent(eventId)}/`);
}

// All live, public events at a venue, with venue details included
async function listVenueEvents(venueId) {
  const events = [];
  let continuation;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      status: 'live',
      only_public: 'true',
      order_by: 'start_asc',
      expand: 'venue',
    };
    if (continuation) params.continuation = continuation;

    const body = await request(`/venues/${encodeURIComponent(venueId)}/events/`, params);
    events.push(...(body.events || []));

    if (!body.pagination || !body.pagination.has_more_items) break;
    continuation = body.pagination.continuation;
  }

  return events;
}

module.exports = { getEvent, listVenueEvents, EventbriteError };
