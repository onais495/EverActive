const crypto = require('crypto');
const prisma = require('../db');

// SRS 4.2: users must re-authenticate after 24 hours of inactivity
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
// Hard cap so a lost phone that keeps the app open doesn't stay logged in forever
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Only write lastActiveAt once a minute, so every request isn't a DB write
const TOUCH_INTERVAL_MS = 60 * 1000;

// The user fields routes can see on req.user. Deliberately excludes the password hash,
// so no route can leak it by accident.
const SESSION_USER_FIELDS = {
  id: true,
  nameFirst: true,
  nameLast: true,
  email: true,
  role: true,
  isActive: true,
  metroArea: true,
};

// Only the hash is stored, so a leaked database can't be used to log in as anyone
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), lastActiveAt: new Date() },
  });
  return token;
}

// Returns { sessionId, user } for a valid token, or null if the token is unknown,
// idle too long, past its max age, or belongs to a deactivated account
async function validateSession(token) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: SESSION_USER_FIELDS } },
  });
  if (!session) return null;

  const now = Date.now();
  const idleMs = now - session.lastActiveAt.getTime();
  const ageMs = now - session.createdAt.getTime();

  if (idleMs > SESSION_IDLE_MS || ageMs > SESSION_MAX_AGE_MS || !session.user.isActive) {
    await destroySession(session.id);
    return null;
  }

  // Sliding expiry: activity pushes the 24h window forward
  if (idleMs > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date(now) },
    });
  }

  return { sessionId: session.id, user: session.user };
}

async function destroySession(sessionId) {
  // deleteMany doesn't throw if the session is already gone
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

// Logs a user out on every device. For admin deactivation (US011) and password changes.
async function destroyUserSessions(userId) {
  await prisma.session.deleteMany({ where: { userId } });
}

module.exports = {
  createSession,
  validateSession,
  destroySession,
  destroyUserSessions,
  SESSION_IDLE_MS,
  SESSION_MAX_AGE_MS,
};
