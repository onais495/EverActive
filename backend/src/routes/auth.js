const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../db');
const { createSession, destroySession } = require('../services/sessions');
const { requireAuth } = require('../middleware/auth');
const { validateRegistration, normalizeEmail } = require('../validation');
const { loginByIp, loginByEmail, registerByIp } = require('../middleware/rateLimit');

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
  };
}

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

  // Log the user straight in after signing up
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

module.exports = router;
