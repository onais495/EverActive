// One-time 6-digit codes for confirming an email address and resetting a password.
// Codes instead of links: the app has no website to open a link in, and typing six digits
// from an email into the app is simpler for our users than a deep link.
const crypto = require('crypto');
const prisma = require('../db');
const { sendEmail } = require('./email');

const PURPOSES = {
  VERIFY_EMAIL: {
    ttlMs: 24 * 60 * 60 * 1000,
    subject: 'Your EverActive confirmation code',
    body: (name, code) =>
      `Hi ${name},\n\nWelcome to EverActive! Your confirmation code is:\n\n${code}\n\n` +
      'Enter it in the app to confirm your email address. The code works for 24 hours.\n\n' +
      "If you didn't create an EverActive account, you can ignore this email.",
  },
  RESET_PASSWORD: {
    ttlMs: 15 * 60 * 1000,
    subject: 'Your EverActive password reset code',
    body: (name, code) =>
      `Hi ${name},\n\nYour password reset code is:\n\n${code}\n\n` +
      'Enter it in the app to choose a new password. The code works for 15 minutes.\n\n' +
      "If you didn't ask to reset your password, you can ignore this email. Your password hasn't changed.",
  },
};
// Six digits can be guessed, so each code only gets a few tries
const MAX_ATTEMPTS = 5;

// Tied to the user and purpose, so a code for one thing can't be used for another
function hashCode(userId, purpose, code) {
  return crypto.createHash('sha256').update(`${userId}:${purpose}:${code}`).digest('hex');
}

// Replaces any earlier code for the same purpose and emails the new one
async function sendCode(user, purpose) {
  const config = PURPOSES[purpose];
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  await prisma.emailCode.deleteMany({ where: { userId: user.id, purpose } });
  await prisma.emailCode.create({
    data: {
      userId: user.id,
      purpose,
      codeHash: hashCode(user.id, purpose, code),
      expiresAt: new Date(Date.now() + config.ttlMs),
    },
  });

  return sendEmail({ to: user.email, subject: config.subject, text: config.body(user.nameFirst, code) });
}

// True if the code is right; the code is then used up. Wrong guesses count against the code.
async function checkCode(userId, purpose, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;

  const record = await prisma.emailCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' } });
  if (!record || record.expiresAt < new Date() || record.attempts >= MAX_ATTEMPTS) return false;

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(userId, purpose, code.trim()), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await prisma.emailCode.update({ where: { id: record.id }, data: { attempts: record.attempts + 1 } });
    return false;
  }

  await prisma.emailCode.deleteMany({ where: { userId, purpose } });
  return true;
}

module.exports = { sendCode, checkCode, MAX_ATTEMPTS };
