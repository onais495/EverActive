const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../db');
const { createSession, destroySession, destroyUserSessions } = require('../services/sessions');
const { sendCode, checkCode } = require('../services/emailCodes');
const { requireAuth } = require('../middleware/auth');
const { validateRegistration, normalizeEmail, passwordError } = require('../validation');
const {
  loginByIp,
  loginByEmail,
  registerByIp,
  codeEntryByUser,
  codeSendByUser,
  forgotByIp,
  forgotByEmail,
  resetByEmail,
} = require('../middleware/rateLimit');

const router = express.Router();
// Tests lower this through BCRYPT_ROUNDS; 12 is ~250ms per hash on a laptop
const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

// The only user fields that ever leave the server (never the password hash)
function publicUser(user) {
  return {
    id: user.id,
    nameFirst: user.nameFirst,
    nameLast: user.nameLast,
    email: user.email,
    role: user.role,
    metroArea: user.metroArea,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

// Email problems (quota, outage) must never block signing up or asking for a reset
async function trySendCode(user, purpose) {
  try {
    await sendCode(user, purpose);
  } catch (err) {
    console.error(`Could not send ${purpose} email:`, err.message);
  }
}

const BAD_CODE = 'That code is wrong or has expired. Please request a new one.';

// POST /api/auth/register (was /signup)
router.post('/register', registerByIp, async (req, res) => {
  const { errors, data } = validateRegistration(req.body || {});
  if (errors) {
    return res.status(400).json({ message: errors[0], errors });
  }

  let user;
  try {
    user = await prisma.user.create({
      data: { ...data, password: await bcrypt.hash(data.password, SALT_ROUNDS) },
    });
  } catch (err) {
    // P2002 = unique constraint failed, i.e. the email is already registered
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    throw err;
  }

  await trySendCode(user, 'VERIFY_EMAIL');
  // Log the user straight in after signing up; confirming the email can happen later
  const token = await createSession(user.id);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', loginByIp, loginByEmail, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ message: 'Please enter your email and password.' });
  }

  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  const passwordMatches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !passwordMatches) {
    return res.status(401).json({ message: 'Incorrect email or password.' });
  }
  if (!user.isActive) {
    return res.status(403).json({ message: 'This account has been deactivated. Please contact support.' });
  }

  const token = await createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  await destroySession(req.sessionId);
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/me (was /currentUser). The app calls this on launch to check the stored token.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// POST /api/auth/email/verify: { code } from the confirmation email
router.post('/email/verify', requireAuth, codeEntryByUser, async (req, res) => {
  if (req.user.emailVerifiedAt) return res.json({ user: publicUser(req.user) });
  if (!(await checkCode(req.user.id, 'VERIFY_EMAIL', (req.body || {}).code))) {
    return res.status(400).json({ message: BAD_CODE });
  }
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { emailVerifiedAt: new Date() } });
  res.json({ user: publicUser(user) });
});

// POST /api/auth/email/resend: a new confirmation code (the old one stops working)
router.post('/email/resend', requireAuth, codeSendByUser, async (req, res) => {
  if (req.user.emailVerifiedAt) return res.json({ message: 'Your email is already confirmed.' });
  await trySendCode(req.user, 'VERIFY_EMAIL');
  res.json({ message: 'We sent a new code to your email.' });
});

// POST /api/auth/password/forgot: { email }. The answer is the same whether or not the account
// exists, and the email is sent after responding, so neither the message nor the timing reveals it.
router.post('/password/forgot', forgotByIp, forgotByEmail, async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ message: 'Please enter your email address.' });
  }
  res.json({ message: 'If an account uses that email, we sent it a code. It works for 15 minutes.' });

  // Already responded, so errors are logged here rather than passed to the error handler
  try {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (user && user.isActive) await trySendCode(user, 'RESET_PASSWORD');
  } catch (err) {
    console.error('Password reset request failed:', err.message);
  }
});

// POST /api/auth/password/reset: { email, code, password }. Logs out every device, then logs this one in.
router.post('/password/reset', resetByEmail, async (req, res) => {
  const { email, code, password } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || typeof code !== 'string') {
    return res.status(400).json({ message: 'Please enter your email, the code and a new password.' });
  }
  const pwError = passwordError(password);
  if (pwError) return res.status(400).json({ message: pwError });

  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || !user.isActive || !(await checkCode(user.id, 'RESET_PASSWORD', code))) {
    return res.status(400).json({ message: BAD_CODE });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    // Getting the code proves they own the inbox, so it confirms the email too
    data: { password: await bcrypt.hash(password, SALT_ROUNDS), emailVerifiedAt: user.emailVerifiedAt || new Date() },
  });
  await destroyUserSessions(user.id);
  const token = await createSession(user.id);
  res.json({ token, user: publicUser(updated) });
});

module.exports = router;
