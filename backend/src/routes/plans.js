const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { planByUser } = require('../middleware/rateLimit');
const planner = require('../services/planner');

const router = express.Router();
router.use(requireAuth);

const NOT_FOUND = { message: 'We couldn’t find that activity.' };

// Route params arrive as strings; anything that isn't a positive integer can't be a real item
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// GET /api/plans/current: this week's activities (empty items if none generated yet)
router.get('/current', async (req, res) => {
  res.json(await planner.getPlan(req.user));
});

// POST /api/plans/current/generate (US004): build or rebuild this week's plan.
// `source` says whether the AI or the rules fallback chose the events.
router.post('/current/generate', planByUser, async (req, res) => {
  res.json(await planner.generatePlan(req.user));
});

// GET /api/plans/items/:id: one activity with full details (for the Activity Detail screen)
router.get('/items/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const item = id && (await planner.getPlanItem(req.user, id));
  if (!item) return res.status(404).json(NOT_FOUND);
  res.json({ item });
});

async function notInterested(req, res) {
  const id = parseId(req.params.id);
  const result = id && (await planner.markNotInterested(req.user, id));
  if (!result || result.error) return res.status(404).json(NOT_FOUND);
  res.json({ message: 'Got it. We won’t suggest this again.' });
}

// POST /api/plans/items/:id/not-interested (US005): one tap to hide an activity and teach the plan
router.post('/items/:id/not-interested', notInterested);
// Older app builds call DELETE for "Remove"; it does the same thing
router.delete('/items/:id', notInterested);

// POST /api/plans/items/:id/attended (US012): the user went; future plans learn from it
router.post('/items/:id/attended', async (req, res) => {
  const id = parseId(req.params.id);
  const result = id && (await planner.markAttended(req.user, id));
  if (!result || result.error === 'not_found') return res.status(404).json(NOT_FOUND);
  if (result.error === 'not_started') {
    return res.status(400).json({ message: 'You can mark this as attended once it has started.' });
  }
  res.json({ message: 'Thanks! We’ll suggest more like this.', item: await planner.getPlanItem(req.user, id) });
});

// POST /api/plans/items/:id/skipped (US012): the event happened and the user didn't go
router.post('/items/:id/skipped', async (req, res) => {
  const id = parseId(req.params.id);
  const result = id && (await planner.markSkipped(req.user, id));
  if (!result || result.error === 'not_found') return res.status(404).json(NOT_FOUND);
  if (result.error === 'not_started') {
    return res.status(400).json({ message: 'You can mark this once it has started.' });
  }
  res.json({ message: 'Thanks for letting us know.', item: await planner.getPlanItem(req.user, id) });
});

// PUT /api/plans/items/:id/rating (US012): { rating: 1-5 } for an activity the user attended
router.put('/items/:id/rating', async (req, res) => {
  const id = parseId(req.params.id);
  const { rating } = req.body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Please choose a rating from 1 to 5 stars.' });
  }
  const result = id && (await planner.rateItem(req.user, id, rating));
  if (!result || result.error === 'not_found') return res.status(404).json(NOT_FOUND);
  if (result.error === 'not_attended') {
    return res.status(400).json({ message: 'You can rate an activity after marking that you went.' });
  }
  res.json({ message: 'Thanks for the rating!', item: await planner.getPlanItem(req.user, id) });
});

module.exports = router;
