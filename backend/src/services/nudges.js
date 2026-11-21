// Behavioral Nudging System (US009). Once a day, users who haven't been to a social activity in a
// week get a gentle, personal reminder with one or two real social events coming up. Every nudge is
// shown in the app; it's also emailed (confirmed addresses that haven't opted out) and pushed to
// registered phones. Messages are built from templates, not the LLM: they include the user's name,
// which never goes to Gemini.
const crypto = require('crypto');
const prisma = require('../db');
const { sendEmail } = require('./email');
const { sendPush } = require('./push');
const { matchInterests, joinPhrases } = require('./interests');
const { formatDayAndTime, DAY_MS } = require('../time');
const { METRO_AREAS, DEFAULT_METRO_AREA } = require('../constants');

const HOUR_MS = 60 * 60 * 1000;
// SRS US009: "if I have not done anything socially for a while"
const SOCIAL_GAP_DAYS = 7;
// Never more often than this, however long the gap
const MIN_DAYS_BETWEEN_NUDGES = 3;
// A nudge stays in the app for this long unless dismissed
const NUDGE_VISIBLE_DAYS = 7;
const SUGGESTIONS = 2;
// Don't suggest something starting too soon to get to
const MIN_LEAD_MS = 2 * HOUR_MS;

function metroFor(user) {
  return METRO_AREAS[user.metroArea] || METRO_AREAS[DEFAULT_METRO_AREA];
}

function shortTitle(title) {
  const t = title.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

// Most recent attended Social activity, or null if there has never been one
async function lastSocialOuting(userId) {
  const attended = await prisma.planItem.findMany({ where: { userId, status: 'ATTENDED' }, include: { event: true } });
  return attended
    .filter((p) => p.event && p.event.category === 'Social')
    .reduce((latest, p) => (!latest || p.event.startsAt > latest ? p.event.startsAt : latest), null);
}

// Upcoming social events this user would plausibly want: in their plan first, then by interest match
async function pickSocialEvents(user, interests, now) {
  const metroArea = METRO_AREAS[user.metroArea] ? user.metroArea : DEFAULT_METRO_AREA;
  const [events, responses, planned] = await Promise.all([
    prisma.event.findMany({
      where: {
        metroArea,
        category: 'Social',
        isSuitable: true,
        startsAt: { gte: new Date(now.getTime() + MIN_LEAD_MS), lt: new Date(now.getTime() + 7 * DAY_MS) },
      },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.planItem.findMany({ where: { userId: user.id, status: { in: ['NOT_INTERESTED', 'ATTENDED', 'SKIPPED'] } } }),
    prisma.planItem.findMany({ where: { userId: user.id, status: 'SUGGESTED' } }),
  ]);

  const excluded = new Set(responses.map((r) => r.eventId));
  const inPlan = new Map(planned.map((p) => [p.eventId, p.id]));
  const seenTitles = new Set();

  return events
    .filter((e) => {
      const title = e.title.trim().toLowerCase();
      if (excluded.has(e.id) || seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    })
    .map((event) => {
      const matches = matchInterests(event, interests);
      const score = (inPlan.has(event.id) ? 10 : 0) + matches.reduce((sum, i) => sum + (i.weight || 1), 0);
      return { event, matches, planItemId: inPlan.get(event.id) || null, score };
    })
    .sort((a, b) => b.score - a.score || a.event.startsAt - b.event.startsAt)
    .slice(0, SUGGESTIONS);
}

function buildMessage({ daysSince, picks, timeZone }) {
  const opening =
    daysSince === null
      ? "You haven't been to a social event with EverActive yet."
      : `It's been ${daysSince} days since your last social outing.`;

  const [first, second] = picks;
  const when = (e) => {
    const { day, time } = formatDayAndTime(e.startsAt, timeZone);
    return `${day} at ${time}`;
  };
  const title = (e) => `"${shortTitle(e.title)}"`;

  let suggestion = first.matches.length
    ? `Since you like ${joinPhrases(first.matches.slice(0, 2).map((i) => i.name))}, ${title(first.event)} on ${when(first.event)} could be a nice way to get out.`
    : `${title(first.event)} on ${when(first.event)} is an easy way to spend time with people.`;
  if (first.planItemId) suggestion += " It's already in your plan for this week.";
  const alternative = second ? ` Or try ${title(second.event)} on ${when(second.event)}.` : '';

  return `${opening} ${suggestion}${alternative}`.slice(0, 500);
}

// Returns the nudge to send this user now, or null. Pure decision: writes nothing.
async function nudgeFor(user, now = new Date()) {
  const last = await lastSocialOuting(user.id);
  // New users get a week to settle in before the first nudge
  const since = last || user.createdAt;
  if (now - since < SOCIAL_GAP_DAYS * DAY_MS) return null;

  const recent = await prisma.nudge.findFirst({
    where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - MIN_DAYS_BETWEEN_NUDGES * DAY_MS) } },
  });
  if (recent) return null;

  const interests = await prisma.interest.findMany({ where: { userId: user.id } });
  const picks = await pickSocialEvents(user, interests, now);
  // Nothing worth suggesting: stay quiet rather than send an empty reminder
  if (picks.length === 0) return null;

  const daysSince = last ? Math.floor((now - last) / DAY_MS) : null;
  return {
    kind: 'SOCIAL_GAP',
    message: buildMessage({ daysSince, picks, timeZone: metroFor(user).timeZone }),
    eventIds: picks.map((p) => p.event.id),
  };
}

function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // Set automatically by Railway
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return null;
}

async function unsubscribeUrl(user) {
  const base = publicBaseUrl();
  if (!base) return null;
  let token = user.unsubscribeToken;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    await prisma.user.update({ where: { id: user.id }, data: { unsubscribeToken: token } });
  }
  return `${base}/api/nudges/unsubscribe?token=${token}`;
}

async function emailNudge(user, message) {
  const link = await unsubscribeUrl(user);
  const footer = link
    ? `Don't want these reminders by email? Turn them off here: ${link}`
    : "Don't want these reminders by email? You can turn them off in the app's settings.";
  return sendEmail({
    to: user.email,
    subject: 'A little nudge from EverActive',
    text: `Hi ${user.nameFirst},\n\n${message}\n\nOpen EverActive to see your week.\n\n${footer}`,
    headers: link ? { 'List-Unsubscribe': `<${link}>` } : undefined,
  });
}

// Creates and delivers one user's nudge. Delivery problems are logged, never fatal: the nudge is
// still in the app.
async function sendNudge(user, nudge, now) {
  const record = await prisma.nudge.create({ data: { userId: user.id, ...nudge, createdAt: now } });
  const delivered = { emailed: false, pushed: false };

  if (user.nudgeEmails && user.emailVerifiedAt) {
    try {
      delivered.emailed = await emailNudge(user, nudge.message);
    } catch (err) {
      console.error('Nudge email failed:', err.message);
    }
  }
  try {
    delivered.pushed =
      (await sendPush(user.id, { title: 'Time to get out?', body: nudge.message.slice(0, 178), data: { screen: 'plan', nudgeId: record.id } })) > 0;
  } catch (err) {
    console.error('Nudge push failed:', err.message);
  }

  const stamps = {};
  if (delivered.emailed) stamps.emailedAt = now;
  if (delivered.pushed) stamps.pushedAt = now;
  if (Object.keys(stamps).length) await prisma.nudge.update({ where: { id: record.id }, data: stamps });
  return delivered;
}

async function runNudges(now = new Date()) {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameFirst: true,
      email: true,
      metroArea: true,
      createdAt: true,
      emailVerifiedAt: true,
      nudgeEmails: true,
      unsubscribeToken: true,
    },
  });
  const summary = { checked: users.length, nudged: 0, emailed: 0, pushed: 0, failed: 0 };

  for (const user of users) {
    try {
      const nudge = await nudgeFor(user, now);
      if (!nudge) continue;
      const delivered = await sendNudge(user, nudge, now);
      summary.nudged++;
      if (delivered.emailed) summary.emailed++;
      if (delivered.pushed) summary.pushed++;
    } catch (err) {
      summary.failed++;
      console.error(`Nudge failed for user ${user.id}:`, err.message);
    }
  }
  return summary;
}

// The app's banner: the newest nudge from the last week that hasn't been dismissed
async function currentNudge(user, now = new Date()) {
  const nudge = await prisma.nudge.findFirst({
    where: { userId: user.id, dismissedAt: null, createdAt: { gte: new Date(now.getTime() - NUDGE_VISIBLE_DAYS * DAY_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  if (!nudge) return null;
  if (!nudge.seenAt) await prisma.nudge.update({ where: { id: nudge.id }, data: { seenAt: now } });

  const ids = Array.isArray(nudge.eventIds) ? nudge.eventIds : [];
  const [events, planned] = await Promise.all([
    prisma.event.findMany({ where: { id: { in: ids } } }),
    prisma.planItem.findMany({ where: { userId: user.id, eventId: { in: ids }, status: 'SUGGESTED' } }),
  ]);
  const { timeZone } = metroFor(user);
  return {
    id: nudge.id,
    kind: nudge.kind,
    message: nudge.message,
    createdAt: nudge.createdAt.toISOString(),
    events: ids
      .map((id) => events.find((e) => e.id === id))
      // Hide suggestions that have already started
      .filter((e) => e && e.startsAt > now)
      .map((e) => ({
        eventId: e.id,
        title: e.title,
        ...formatDayAndTime(e.startsAt, timeZone),
        startsAt: e.startsAt.toISOString(),
        location: e.venueName || e.address,
        url: e.url,
        planItemId: (planned.find((p) => p.eventId === e.id) || {}).id || null,
      })),
  };
}

async function dismissNudge(user, nudgeId) {
  const { count } = await prisma.nudge.updateMany({
    where: { id: nudgeId, userId: user.id, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
  return count > 0 || Boolean(await prisma.nudge.findFirst({ where: { id: nudgeId, userId: user.id } }));
}

// The one-tap link in nudge emails. Returns true if the token belonged to someone.
async function unsubscribeByToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return false;
  const { count } = await prisma.user.updateMany({ where: { unsubscribeToken: token }, data: { nudgeEmails: false } });
  return count > 0;
}

module.exports = {
  runNudges,
  nudgeFor,
  currentNudge,
  dismissNudge,
  unsubscribeByToken,
  buildMessage,
  SOCIAL_GAP_DAYS,
  MIN_DAYS_BETWEEN_NUDGES,
};
