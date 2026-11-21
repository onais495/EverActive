const { runNudges } = require('../services/nudges');
const { METRO_AREAS, DEFAULT_METRO_AREA } = require('../constants');

const CHECK_EVERY_MS = 60 * 60 * 1000;
// Reminders go out mid-morning New York time, never at night
const DEFAULT_SEND_HOUR = 10;

function localDateAndHour(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Checks hourly and runs once a day in the send hour. Off unless NUDGES_ENABLED=true, so local dev
// and tests never email anyone. Restarts are safe: each user gets at most one nudge every 3 days.
function startNudgeJob() {
  if (process.env.NUDGES_ENABLED !== 'true') return;

  const sendHour = Number(process.env.NUDGE_SEND_HOUR) || DEFAULT_SEND_HOUR;
  const { timeZone } = METRO_AREAS[DEFAULT_METRO_AREA];
  let lastRunDate = null;

  const tick = async () => {
    const { date, hour } = localDateAndHour(new Date(), timeZone);
    if (hour !== sendHour || date === lastRunDate) return;
    lastRunDate = date;
    const s = await runNudges();
    console.log(`Nudges: ${s.checked} users checked, ${s.nudged} nudged (${s.emailed} emailed, ${s.pushed} pushed), ${s.failed} failed.`);
  };
  const safeTick = () => tick().catch((err) => console.error('Nudge job crashed:', err));

  setTimeout(safeTick, 90 * 1000).unref();
  setInterval(safeTick, CHECK_EVERY_MS).unref();
  console.log(`Nudges scheduled daily at ${sendHour}:00 New York time.`);
}

module.exports = { startNudgeJob, localDateAndHour };
