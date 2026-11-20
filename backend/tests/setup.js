// Cheapest bcrypt cost, so tests don't spend seconds hashing. Must be set before app code loads.
process.env.BCRYPT_ROUNDS = '4';

// Every test file uses the in-memory fake instead of a real database
jest.mock('../src/db', () => require('./helpers/fakeDb'));
// Never send real email; tests read the code from the mock's last call
jest.mock('../src/services/email', () => ({ sendEmail: jest.fn(), isConfigured: () => true }));

beforeEach(() => {
  require('../src/services/email').sendEmail.mockReset().mockResolvedValue(true);
  require('./helpers/fakeDb').reset();
  require('../src/middleware/rateLimit').resetRateLimits();
});
