// Calendar helpers. Plans are keyed by the Monday of the week in the metro area's time zone.
const DAY_MS = 24 * 60 * 60 * 1000;

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day'), weekday: get('weekday') };
}

const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// The Monday of `now`'s week (in timeZone), as a UTC-midnight Date for a date-only column
function weekStartFor(now, timeZone) {
  const { year, month, day, weekday } = localParts(now, timeZone);
  const localDate = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return new Date(localDate - WEEKDAY_INDEX[weekday] * DAY_MS);
}

// "Thursday" and "7:00 PM" for the app's activity cards
function formatDayAndTime(date, timeZone) {
  return {
    day: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date),
    time: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date),
  };
}

module.exports = { weekStartFor, formatDayAndTime, DAY_MS };
