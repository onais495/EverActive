const { runSync } = require('../services/eventSync');

const STARTUP_DELAY_MS = 60 * 1000;
const DEFAULT_INTERVAL_HOURS = 24;

async function runAndLog() {
  const results = await runSync();
  if (!results) return console.log('Event sync skipped: a sync is already running.');
  const saved = results.reduce((sum, r) => sum + (r.saved || 0), 0);
  const failed = results.filter((r) => r.error).length;
  console.log(`Event sync finished: ${results.length} sources, ${saved} events saved, ${failed} failed.`);
}

// Runs inside the backend process (no separate cron service), so it moves with the app between hosts.
// Off unless EVENT_SYNC_ENABLED=true, so local dev and tests never call Eventbrite by accident.
function startEventSyncJob() {
  if (process.env.EVENT_SYNC_ENABLED !== 'true') return;

  const hours = Number(process.env.EVENT_SYNC_INTERVAL_HOURS) || DEFAULT_INTERVAL_HOURS;
  const safeRun = () => runAndLog().catch((err) => console.error('Event sync crashed:', err));

  setTimeout(safeRun, STARTUP_DELAY_MS).unref();
  setInterval(safeRun, hours * 60 * 60 * 1000).unref();
  console.log(`Event sync scheduled every ${hours}h.`);
}

module.exports = { startEventSyncJob };
