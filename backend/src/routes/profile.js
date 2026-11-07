const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateInterests, validatePreferences } = require('../validation');
const { ACTIVITY_TYPES, INTEREST_OPTIONS, METRO_AREAS, DEFAULT_METRO_AREA } = require('../constants');

// Mounted at /api, so auth goes on each route rather than router.use (which would catch every /api path)
const router = express.Router();

async function interestsResponse(userId) {
  const rows = await prisma.interest.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return {
    options: INTEREST_OPTIONS,
    interests: rows.filter((r) => !r.isCustom).map((r) => r.name),
    custom: rows.filter((r) => r.isCustom).map((r) => r.name),
  };
}

function preferencesResponse(user) {
  return {
    metroArea: user.metroArea || DEFAULT_METRO_AREA,
    activityTypes: Array.isArray(user.activityTypes) && user.activityTypes.length ? user.activityTypes : ACTIVITY_TYPES,
    options: {
      metroAreas: Object.entries(METRO_AREAS).map(([id, m]) => ({ id, label: m.label })),
      activityTypes: ACTIVITY_TYPES,
    },
  };
}

// GET /api/interests (US003): the onboarding options plus what the user picked
router.get('/interests', requireAuth, async (req, res) => {
  res.json(await interestsResponse(req.user.id));
});

// PUT /api/interests: replaces the whole list, used by both onboarding and editing
router.put('/interests', requireAuth, async (req, res) => {
  const { errors, data } = validateInterests(req.body || {});
  if (errors) return res.status(400).json({ message: errors[0], errors });

  await prisma.$transaction([
    prisma.interest.deleteMany({ where: { userId: req.user.id } }),
    prisma.interest.createMany({ data: data.map((i) => ({ ...i, userId: req.user.id })) }),
  ]);
  res.json(await interestsResponse(req.user.id));
});

// GET /api/preferences (US006): city and which activity types to include in plans
router.get('/preferences', requireAuth, (req, res) => {
  res.json(preferencesResponse(req.user));
});

// PUT /api/preferences: partial update, e.g. { activityTypes: ['Social', 'Intellectual'] }
router.put('/preferences', requireAuth, async (req, res) => {
  const { errors, data } = validatePreferences(req.body || {});
  if (errors) return res.status(400).json({ message: errors[0], errors });

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: { metroArea: true, activityTypes: true },
  });
  res.json(preferencesResponse(user));
});

module.exports = router;
