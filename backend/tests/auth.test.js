const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { SESSION_IDLE_MS, SESSION_MAX_AGE_MS, destroyUserSessions } = require('../src/services/sessions');

const validUser = {
  nameFirst: 'Gertrude',
  nameLast: 'Chen',
  dateBirth: '1959-04-12',
  email: 'Gertrude@Example.com',
  password: 'retired2025',
};

function register(overrides = {}) {
  return request(app).post('/api/auth/register').send({ ...validUser, ...overrides });
}

function login(email = validUser.email, password = validUser.password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function me(token) {
  return request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
}

describe('POST /api/auth/register', () => {
  test('creates an account and logs the user in', async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'gertrude@example.com', role: 'USER' });
    expect(res.body.user.password).toBeUndefined();
  });

  test('stores a bcrypt hash, never the plain password', async () => {
    await register();
    expect(fakeDb.users[0].password).not.toBe(validUser.password);
    expect(fakeDb.users[0].password).toMatch(/^\$2[aby]\$/);
  });

  test('rejects an invalid email', async () => {
    const res = await register({ email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test('rejects a weak password', async () => {
    const res = await register({ password: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/password/i);
  });

  test('rejects a common password', async () => {
    const res = await register({ password: 'Password123' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/too easy to guess/);
  });

  test.each([
    ['not a date', 'yesterday'],
    ['wrong format', '04/12/1959'],
    ['impossible date', '1959-02-30'],
    ['under 18', `${new Date().getUTCFullYear() - 10}-01-01`],
    ['over 120', '1880-01-01'],
  ])('rejects a date of birth that is %s', async (_, dateBirth) => {
    const res = await register({ dateBirth });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/date of birth/);
  });

  test('stores date of birth without shifting the day', async () => {
    await register();
    expect(fakeDb.users[0].dateBirth.toISOString()).toBe('1959-04-12T00:00:00.000Z');
  });

  test('rejects missing fields with every problem listed', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(1);
  });

  test('rejects a duplicate email regardless of case', async () => {
    await register();
    const res = await register({ email: 'GERTRUDE@example.com' });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => register());

  test('returns a token for correct credentials', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  test('rejects a wrong password', async () => {
    const res = await login(validUser.email, 'wrongpass1');
    expect(res.statusCode).toBe(401);
  });

  test('gives the same response for an unknown email', async () => {
    const res = await login('nobody@example.com', validUser.password);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Incorrect email or password.');
  });

  test('rejects a deactivated account', async () => {
    fakeDb.users[0].isActive = false;
    const res = await login();
    expect(res.statusCode).toBe(403);
  });
});

describe('rate limiting', () => {
  test('locks an account after 5 failed logins, even from different IPs', async () => {
    await register();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ email: validUser.email, password: 'wrongpass12' });
      expect(res.statusCode).toBe(401);
    }
    const res = await login();
    expect(res.statusCode).toBe(429);
    expect(res.body.message).toMatch(/too many/i);
  });

  test('successful logins do not count towards the lockout', async () => {
    await register();
    for (let i = 0; i < 6; i++) {
      expect((await login()).statusCode).toBe(200);
    }
  });

  test('limits sign-ups per IP', async () => {
    for (let i = 0; i < 10; i++) {
      await register({ email: `user${i}@example.com` });
    }
    const res = await register({ email: 'one-more@example.com' });
    expect(res.statusCode).toBe(429);
  });
});

describe('sessions', () => {
  let token;
  beforeEach(async () => {
    token = (await register()).body.token;
  });

  test('GET /me returns the user for a valid token', async () => {
    const res = await me(token);
    expect(res.statusCode).toBe(200);
    expect(res.body.user.email).toBe('gertrude@example.com');
  });

  test('GET /me rejects a missing or bad token', async () => {
    expect((await request(app).get('/api/auth/me')).statusCode).toBe(401);
    expect((await me('made-up-token')).statusCode).toBe(401);
  });

  test('only a hash of the token is stored', () => {
    expect(fakeDb.sessions[0].tokenHash).not.toBe(token);
  });

  test('expires after 24 hours of inactivity', async () => {
    fakeDb.sessions[0].lastActiveAt = new Date(Date.now() - SESSION_IDLE_MS - 1000);
    expect((await me(token)).statusCode).toBe(401);
    expect(fakeDb.sessions).toHaveLength(0);
  });

  test('activity pushes the expiry forward', async () => {
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
    fakeDb.sessions[0].lastActiveAt = twentyHoursAgo;
    await me(token);
    expect(fakeDb.sessions[0].lastActiveAt.getTime()).toBeGreaterThan(twentyHoursAgo.getTime());
  });

  test('expires after 30 days even with constant activity', async () => {
    fakeDb.sessions[0].createdAt = new Date(Date.now() - SESSION_MAX_AGE_MS - 1000);
    expect((await me(token)).statusCode).toBe(401);
  });

  test('accepts the auth scheme in any case', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('destroyUserSessions logs the user out on every device', async () => {
    const secondToken = (await login()).body.token;
    await destroyUserSessions(fakeDb.users[0].id);
    expect((await me(token)).statusCode).toBe(401);
    expect((await me(secondToken)).statusCode).toBe(401);
  });

  test('stops working once the account is deactivated', async () => {
    fakeDb.users[0].isActive = false;
    expect((await me(token)).statusCode).toBe(401);
  });

  test('logout makes the token stop working', async () => {
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);
  });
});

describe('middleware', () => {
  const express = require('express');
  const { requireAuth, requireRole } = require('../src/middleware/auth');

  const adminApp = express();
  adminApp.get('/admin-only', requireAuth, requireRole('ADMIN'), (req, res) => res.json({ ok: true }));

  test('req.user never contains the password hash', async () => {
    const leakyApp = express();
    leakyApp.get('/whoami', requireAuth, (req, res) => res.json(req.user));
    const token = (await register()).body.token;
    const res = await request(leakyApp).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.body.email).toBe('gertrude@example.com');
    expect(res.body).not.toHaveProperty('password');
  });

  test('blocks regular users and allows admins', async () => {
    const token = (await register()).body.token;
    const asUser = await request(adminApp).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(asUser.statusCode).toBe(403);

    fakeDb.users[0].role = 'ADMIN';
    const asAdmin = await request(adminApp).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(asAdmin.statusCode).toBe(200);
  });
});

test('responses do not advertise Express', async () => {
  const res = await request(app).get('/api/health');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
