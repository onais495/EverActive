// Luma (luma.com) events, read from public iCal subscription feeds: either one calendar, or a whole
// city's "What's Happening" feed (the city page's "Add iCal Subscription").
// Luma's official API only lists events on calendars you own (and needs Luma Plus), while the
// iCal feed is the supported way for anyone to follow a public calendar ("Subscribe" > "Add iCal
// Subscription" on the calendar page). It includes the title, times, venue address and coordinates.
const ICS_URL = 'https://api.lu.ma/ics/get';
const REQUEST_TIMEOUT_MS = 10_000;
// Calendar IDs look like cal-AbC123xyz and city feeds like discplace-AbC123xyz; both appear in the
// iCal subscription link
const FEED_ID_PATTERN = /\b(cal|discplace)-[A-Za-z0-9]{6,40}\b/;

class LumaError extends Error {}

// Accepts a bare ID or any link that contains one (e.g. the iCal subscription URL)
function extractCalendarId(input) {
  const match = FEED_ID_PATTERN.exec(String(input || ''));
  return match ? match[0] : null;
}

// City feeds cover everything in a city, so they need AI screening; calendars are hand-picked
function isCityFeed(feedId) {
  return String(feedId).startsWith('discplace-');
}

// RFC 5545 TEXT values escape commas, semicolons, backslashes and newlines
function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

// "20261207T233000Z" -> Date. Floating or TZID times aren't used by Luma; they return null and the
// event is skipped rather than shown at a guessed time.
function parseUtcDateTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// Splits "NAME;PARAM=x;PARAM2=\"a:b\":value" at the first colon that isn't inside quotes
function splitProperty(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ':' && !inQuotes) {
      const [name, ...params] = line.slice(0, i).split(';');
      return { name: name.toUpperCase(), params: params.map((p) => p.toUpperCase()), value: line.slice(i + 1) };
    }
  }
  return null;
}

// Parses the VEVENTs of an iCal file into plain objects
function parseIcs(input) {
  // Long lines are folded at 75 bytes, which can split a multi-byte character, so unfold the
  // raw bytes first and decode UTF-8 afterwards
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const text = Buffer.from(raw.toString('latin1').replace(/\r?\n[ \t]/g, ''), 'latin1').toString('utf8');

  const events = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = splitProperty(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(prop.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value);
        break;
      case 'GEO': {
        const [lat, lng] = prop.value.split(';').map(Number);
        current.geo = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        break;
      }
      case 'DTSTART':
        current.allDay = prop.params.includes('VALUE=DATE');
        current.start = current.allDay ? null : parseUtcDateTime(prop.value.trim());
        break;
      case 'DTEND':
        current.end = parseUtcDateTime(prop.value.trim());
        break;
      case 'STATUS':
        current.status = prop.value.trim().toUpperCase();
        break;
      default:
        break;
    }
  }
  return events;
}

async function listCalendarEvents(calendarId) {
  const url = new URL(ICS_URL);
  url.searchParams.set('entity', isCityFeed(calendarId) ? 'discover' : 'calendar');
  url.searchParams.set('id', calendarId);

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new LumaError(`Luma calendar feed failed with HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.toString('utf8', 0, 200).includes('BEGIN:VCALENDAR')) {
    throw new LumaError('Luma did not return a calendar feed.');
  }
  return parseIcs(body);
}

module.exports = { listCalendarEvents, parseIcs, extractCalendarId, isCityFeed, LumaError };
