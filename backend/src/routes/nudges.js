const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const nudges = require('../services/nudges');
const { isValidPushToken } = require('../services/push');

// Mounted at /api, so auth goes on each route (the unsubscribe link has no login)
const router = express.Router();

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function page(title, text) {
  const escape = (t) => t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:Arial,sans-serif;font-size:20px;line-height:1.5;max-width:32em;margin:3em auto;padding:0 1em"><h1>${escape(title)}</h1><p>${escape(text)}</p></body></html>`;
}

// GET /api/nudges/current (US009): the reminder to show as a banner on the Plan screen, or null
router.get('/nudges/current', requireAuth, async (req, res) => {
  res.json({ nudge: await nudges.currentNudge(req.user) });
});

// POST /api/nudges/:id/dismiss: hide the banner
router.post('/nudges/:id/dismiss', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id || !(await nudges.dismissNudge(req.user, id))) return res.status(404).json({ message: 'Reminder not found.' });
  res.json({ message: 'Reminder dismissed.' });
});

// GET /api/nudges/unsubscribe?token=...: the link in every nudge email. Opens in a browser, so it
// answers with a plain page, and the same page for any token so it reveals nothing.
router.get('/nudges/unsubscribe', async (req, res) => {
  await nudges.unsubscribeByToken(req.query.token);
  res
    .type('html')
    .send(page('You’re unsubscribed', 'You won’t get reminder emails from EverActive any more. You can turn them back on in the app’s settings.'));
});

// POST /api/devices: { pushToken, platform } registers this phone for push reminders (Expo push token).
// Re-registering a token that moved to another account moves it to this one.
router.post('/devices', requireAuth, async (req, res) => {
  const { pushToken, platform } = req.body || {};
  if (!isValidPushToken(pushToken) || !['ios', 'android'].includes(platform)) {
    return res.status(400).json({ message: 'Send a valid Expo pushToken and platform ("ios" or "android").' });
  }
  await prisma.device.upsert({
    where: { pushToken },
    create: { userId: req.user.id, pushToken, platform },
    update: { userId: req.user.id, platform },
  });
  res.json({ message: 'This device will get reminders.' });
});

// DELETE /api/devices: { pushToken } stops reminders on this phone (call on logout)
router.delete('/devices', requireAuth, async (req, res) => {
  const { pushToken } = req.body || {};
  if (typeof pushToken !== 'string') return res.status(400).json({ message: 'Send the pushToken to remove.' });
  await prisma.device.deleteMany({ where: { pushToken, userId: req.user.id } });
  res.json({ message: 'This device won’t get reminders.' });
});

module.exports = router;
