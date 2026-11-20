// Grouped statistics for the Admin Dashboard (SRS: grouped statistics only, never individual users).
// Every number here is a count over a group; no names, emails, IDs or typed-in text leave this file.
const prisma = require('../db');
const { INTEREST_OPTIONS, METRO_AREAS, DEFAULT_METRO_AREA } = require('../constants');
const { weekStartFor, DAY_MS } = require('../time');

function countsBy(rows, field) {
  return Object.fromEntries(rows.map((r) => [r[field] ?? 'Uncategorized', r._count._all]));
}

async function getAdminStats(now = new Date()) {
  const weekStart = weekStartFor(now, METRO_AREAS[DEFAULT_METRO_AREA].timeZone);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const nextWeek = new Date(now.getTime() + 7 * DAY_MS);
  // Only events that can actually appear in plans
  const upcoming = { startsAt: { gte: now, lt: nextWeek }, isSuitable: true };
  const nextMonth = { startsAt: { gte: now, lt: new Date(now.getTime() + 30 * DAY_MS) } };
  const lastFourWeeks = { respondedAt: { gte: new Date(now.getTime() - 28 * DAY_MS) } };

  const [
    totalUsers,
    activeUsers,
    verifiedUsers,
    newUsers,
    planUsers,
    itemsByStatus,
    upcomingByProvider,
    upcomingByCategory,
    upcomingByType,
    interestCounts,
    customInterests,
    sources,
    eventsPerSource,
    screeningCounts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.planItem.groupBy({ by: ['userId'], where: { weekStart }, _count: { _all: true } }),
    prisma.planItem.groupBy({ by: ['status'], where: { weekStart }, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['provider'], where: upcoming, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['eventCategory'], where: upcoming, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['category'], where: upcoming, _count: { _all: true } }),
    // Only the fixed options are broken down; custom interests are free text and could identify someone
    prisma.interest.groupBy({ by: ['name'], where: { isCustom: false }, _count: { _all: true } }),
    prisma.interest.count({ where: { isCustom: true } }),
    prisma.eventSource.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.event.groupBy({ by: ['sourceId'], where: nextMonth, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['isSuitable'], where: { ...nextMonth, screenedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const withEvents = new Set(eventsPerSource.map((g) => g.sourceId));
  const screened = Object.fromEntries(screeningCounts.map((g) => [String(g.isSuitable), g._count._all]));
  const pendingScreening = await prisma.event.count({ where: { ...nextMonth, isSuitable: null } });

  const statuses = countsBy(itemsByStatus, 'status');

  // US010: attendance and what people actually go to, over the last 4 weeks. "Attendance rate" is
  // attended / (attended + didn't go) among activities users told us about.
  const [outcomes, attendedByType, rated, nudgesSent, nudgesEmailed] = await Promise.all([
    prisma.planItem.groupBy({ by: ['status'], where: { ...lastFourWeeks, status: { in: ['ATTENDED', 'SKIPPED'] } }, _count: { _all: true } }),
    prisma.planItem.groupBy({ by: ['category'], where: { ...lastFourWeeks, status: 'ATTENDED' }, _count: { _all: true } }),
    prisma.planItem.findMany({ where: { ...lastFourWeeks, status: 'ATTENDED', rating: { not: null } }, select: { category: true, rating: true } }),
    prisma.nudge.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.nudge.count({ where: { createdAt: { gte: weekAgo }, emailedAt: { not: null } } }),
  ]);
  const outcome = countsBy(outcomes, 'status');
  const attended = outcome.ATTENDED || 0;
  const skipped = outcome.SKIPPED || 0;
  const ratingsByType = rated.reduce((acc, r) => {
    acc[r.category] = acc[r.category] || { total: 0, count: 0 };
    acc[r.category].total += r.rating;
    acc[r.category].count++;
    return acc;
  }, {});
  const interests = countsBy(interestCounts, 'name');

  return {
    generatedAt: now.toISOString(),
    users: { total: totalUsers, active: activeUsers, emailVerified: verifiedUsers, joinedLast7Days: newUsers },
    plans: {
      weekStart: weekStart.toISOString().slice(0, 10),
      usersWithPlanThisWeek: planUsers.length,
      activitiesThisWeek: {
        suggested: statuses.SUGGESTED || 0,
        attended: statuses.ATTENDED || 0,
        notInterested: statuses.NOT_INTERESTED || 0,
      },
    },
    events: {
      activeSources: sources.length,
      // Sources with nothing in the next 30 days: probably moved or stopped, worth replacing
      sourcesWithNoUpcomingEvents: sources.filter((s) => !withEvents.has(s.id)).map((s) => s.name),
      // AI screening of broad feeds, next 30 days (admin overrides count as screened)
      screening: { approved: screened.true || 0, rejected: screened.false || 0, pending: pendingScreening },
      next7Days: {
        byProvider: countsBy(upcomingByProvider, 'provider'),
        byEventCategory: countsBy(upcomingByCategory, 'eventCategory'),
        byActivityType: countsBy(upcomingByType, 'category'),
      },
    },
    engagement: {
      period: 'last 4 weeks',
      attended,
      didntGo: skipped,
      attendanceRate: attended + skipped > 0 ? Math.round((attended / (attended + skipped)) * 100) / 100 : null,
      mostAttendedActivityTypes: attendedByType
        .map((g) => ({ activityType: g.category, attended: g._count._all }))
        .sort((a, b) => b.attended - a.attended),
      averageRatingByActivityType: Object.fromEntries(
        Object.entries(ratingsByType).map(([type, r]) => [type, { average: Math.round((r.total / r.count) * 10) / 10, ratings: r.count }])
      ),
      nudgesLast7Days: { sent: nudgesSent, emailed: nudgesEmailed },
    },
    interests: {
      byOption: Object.fromEntries(INTEREST_OPTIONS.map((name) => [name, interests[name] || 0])),
      customTotal: customInterests,
    },
  };
}

module.exports = { getAdminStats };
