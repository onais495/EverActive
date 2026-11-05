const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { planByUser } = require('../middleware/rateLimit');
const planner = require('../services/planner');

const router = express.Router();
router.use(requireAuth);

// Route params arrive as strings; anything that isn't a positive integer can't be a real item
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// GET /api/plans/current: this week's suggestions (empty items if none generated yet)
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
  if (!item) return res.status(404).json({ message: 'We couldn’t find that activity.' });
  res.json({ item });
});

// DELETE /api/plans/items/:id (US005): remove an activity from the plan with one tap
router.delete('/items/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const removed = id && (await planner.removePlanItem(req.user, id));
  if (!removed) return res.status(404).json({ message: 'We couldn’t find that activity.' });
  res.json({ message: 'Removed from your plan.' });
});

module.exports = router;
