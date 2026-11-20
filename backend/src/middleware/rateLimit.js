const { rateLimit, ipKeyGenerator, MemoryStore } = require('express-rate-limit');
const { normalizeEmail } = require('../validation');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// In-memory counts are fine while there's a single backend instance.
// Exported so tests can reset them between runs.
const stores = {
  loginByIp: new MemoryStore(),
  loginByEmail: new MemoryStore(),
  registerByIp: new MemoryStore(),
  planByUser: new MemoryStore(),
  codeEntryByUser: new MemoryStore(),
  codeSendByUser: new MemoryStore(),
  forgotByIp: new MemoryStore(),
  forgotByEmail: new MemoryStore(),
  resetByEmail: new MemoryStore(),
};

function limiter({ store, windowMs, limit, message, ...options }) {
  return rateLimit({
    store,
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ message }),
    ...options,
  });
}

// Generous per-IP limit: residents of one retirement community may share an IP
const loginByIp = limiter({
  store: stores.loginByIp,
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

// Strict per-account limit on failed logins, so one password can't be brute-forced
// from many IPs. Successful logins don't count.
const loginByEmail = limiter({
  store: stores.loginByEmail,
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = req.body && req.body.email;
    return typeof email === 'string' ? `email:${normalizeEmail(email)}` : ipKeyGenerator(req.ip);
  },
  message: 'Too many failed attempts for this account. Please wait 15 minutes and try again.',
});

const registerByIp = limiter({
  store: stores.registerByIp,
  windowMs: ONE_HOUR,
  limit: 10,
  message: 'Too many sign-up attempts. Please try again later.',
});

// Each generation is a Gemini call, and the free tier has a daily quota. Use after requireAuth.
const planByUser = limiter({
  store: stores.planByUser,
  windowMs: ONE_HOUR,
  limit: 10,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: "You've rebuilt your plan several times this hour. Please try again later.",
});

// Keyed by the email in the body (normalized), falling back to the IP when there isn't one
function emailKey(req) {
  const email = req.body && req.body.email;
  return typeof email === 'string' ? `email:${normalizeEmail(email)}` : ipKeyGenerator(req.ip);
}

// Entering a confirmation code (each code also locks after 5 wrong tries). Use after requireAuth.
const codeEntryByUser = limiter({
  store: stores.codeEntryByUser,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'Too many attempts. Please wait 15 minutes and try again.',
});

// Sending a new confirmation email costs from the daily email quota. Use after requireAuth.
const codeSendByUser = limiter({
  store: stores.codeSendByUser,
  windowMs: ONE_HOUR,
  limit: 3,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: "We've sent several codes already. Please check your inbox (and spam folder) or try again in an hour.",
});

// "Forgot password" sends an email, so it's limited by network and by account
const forgotByIp = limiter({
  store: stores.forgotByIp,
  windowMs: ONE_HOUR,
  limit: 10,
  message: 'Too many reset requests. Please try again later.',
});

const forgotByEmail = limiter({
  store: stores.forgotByEmail,
  windowMs: ONE_HOUR,
  limit: 3,
  keyGenerator: emailKey,
  message: "We've sent several codes already. Please check your inbox (and spam folder) or try again in an hour.",
});

// Guessing reset codes for one account
const resetByEmail = limiter({
  store: stores.resetByEmail,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: emailKey,
  message: 'Too many attempts. Please wait 15 minutes and try again.',
});

function resetRateLimits() {
  Object.values(stores).forEach((store) => store.resetAll());
}

module.exports = {
  loginByIp,
  loginByEmail,
  registerByIp,
  planByUser,
  codeEntryByUser,
  codeSendByUser,
  forgotByIp,
  forgotByEmail,
  resetByEmail,
  resetRateLimits,
};
