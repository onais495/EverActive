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

function resetRateLimits() {
  Object.values(stores).forEach((store) => store.resetAll());
}

module.exports = { loginByIp, loginByEmail, registerByIp, resetRateLimits };
