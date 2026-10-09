const { validateSession } = require('../services/sessions');

// The auth scheme name is case-insensitive per RFC 7235
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

// Replaces requireLogin from CSC 330: the app sends "Authorization: Bearer <token>"
// instead of a session cookie
async function requireAuth(req, res, next) {
  const match = BEARER_PATTERN.exec(req.get('Authorization') || '');
  if (!match) {
    return res.status(401).json({ message: 'Please log in to continue.' });
  }

  const session = await validateSession(match[1]);
  if (!session) {
    return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
  }

  req.user = session.user;
  req.sessionId = session.sessionId;
  next();
}

// Replaces requireAdmin. Use after requireAuth, e.g. router.get('/stats', requireAuth, requireRole('ADMIN'), ...)
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: 'You do not have access to this page.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
