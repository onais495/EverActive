// Email confirmation and password reset. Email sending is mocked in setup.js.
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sendEmail } = require('../src/services/email');

const account = {
  nameFirst: 'Gertrude',
  nameLast: 'Chen',
  dateBirth: '1959-04-12',
  email: 'gertrude@example.com',
  password: 'retired2025',
};

// The 6-digit code from the most recent email sent to this address
function lastCodeSentTo(email) {
  const call = sendEmail.mock.calls.filter(([msg]) => msg.to === email).at(-1);
  return call && /\b(\d{6})\b/.exec(call[0].text)[1];
}

// The forgot-password email is sent after the response, so wait for it
async function waitForEmail(count) {
  for (let i = 0; i < 50 && sendEmail.mock.calls.length < count; i++) await new Promise((r) => setTimeout(r, 5));
}

async function registered() {
  const res = await request(app).post('/api/auth/register').send(account);
  return { token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` }, body: res.body };
}

describe('email confirmation', () => {
  test('registering sends a code and the account starts unconfirmed', async () => {
    const { body } = await registered();
    expect(body.user.emailVerified).toBe(false);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: account.email, subject: expect.stringMatching(/confirmation/) }));
    expect(lastCodeSentTo(account.email)).toMatch(/^\d{6}$/);
  });

  test('only a hash of the code is stored', async () => {
    await registered();
    const code = lastCodeSentTo(account.email);
    expect(fakeDb.emailCodes).toHaveLength(1);
    expect(JSON.stringify(fakeDb.emailCodes)).not.toContain(code);
  });

  test('the right code confirms the email', async () => {
    const { auth } = await registered();
    const res = await request(app).post('/api/auth/email/verify').set(auth).send({ code: lastCodeSentTo(account.email) });
    expect(res.statusCode).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    expect((await request(app).get('/api/auth/me').set(auth)).body.user.emailVerified).toBe(true);
  });

  test('a wrong code is rejected, and the code locks after 5 wrong tries', async () => {
    const { auth } = await registered();
    const code = lastCodeSentTo(account.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/email/verify').set(auth).send({ code: wrong })).statusCode).toBe(400);
    }
    expect((await request(app).post('/api/auth/email/verify').set(auth).send({ code })).statusCode).toBe(400);
  });

  test('an expired code is rejected', async () => {
    const { auth } = await registered();
    fakeDb.emailCodes[0].expiresAt = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/auth/email/verify').set(auth).send({ code: lastCodeSentTo(account.email) });
    expect(res.statusCode).toBe(400);
  });

  test('resending replaces the old code, and is limited', async () => {
    const { auth } = await registered();
    const first = lastCodeSentTo(account.email);
    await request(app).post('/api/auth/email/resend').set(auth);
    expect(fakeDb.emailCodes).toHaveLength(1);
    const second = lastCodeSentTo(account.email);
    if (first !== second) {
      expect((await request(app).post('/api/auth/email/verify').set(auth).send({ code: first })).statusCode).toBe(400);
    }

    await request(app).post('/api/auth/email/resend').set(auth);
    await request(app).post('/api/auth/email/resend').set(auth);
    expect((await request(app).post('/api/auth/email/resend').set(auth)).statusCode).toBe(429);
  });

  test('sign-up still works when the email service is down', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    sendEmail.mockRejectedValue(new Error('Brevo HTTP 500'));
    const res = await request(app).post('/api/auth/register').send(account);
    expect(res.statusCode).toBe(201);
    error.mockRestore();
  });
});

describe('password reset', () => {
  async function requestReset(email = account.email) {
    const before = sendEmail.mock.calls.length;
    const res = await request(app).post('/api/auth/password/forgot').send({ email });
    await waitForEmail(before + 1);
    return res;
  }

  test('gives the same answer whether or not the account exists, and only emails real accounts', async () => {
    await registered();
    sendEmail.mockClear();
    const real = await requestReset('GERTRUDE@example.com');
    const fake = await requestReset('nobody@example.com');
    expect(real.statusCode).toBe(200);
    expect(fake.body).toEqual(real.body);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toMatch(/password reset/);
  });

  test('the code sets a new password, logs out other devices and logs this one in', async () => {
    const { auth } = await registered();
    await requestReset();
    const res = await request(app)
      .post('/api/auth/password/reset')
      .send({ email: account.email, code: lastCodeSentTo(account.email), password: 'garden-party-2026' });

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    // Receiving the code proves they own the inbox
    expect(res.body.user.emailVerified).toBe(true);
    expect((await request(app).get('/api/auth/me').set(auth)).statusCode).toBe(401);
    expect(await bcrypt.compare('garden-party-2026', fakeDb.users[0].password)).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ email: account.email, password: 'garden-party-2026' });
    expect(login.statusCode).toBe(200);
  });

  test('a code only works once', async () => {
    await registered();
    await requestReset();
    const body = { email: account.email, code: lastCodeSentTo(account.email), password: 'garden-party-2026' };
    expect((await request(app).post('/api/auth/password/reset').send(body)).statusCode).toBe(200);
    expect((await request(app).post('/api/auth/password/reset').send(body)).statusCode).toBe(400);
  });

  test('rejects a wrong code, a weak password, and a confirmation code used as a reset code', async () => {
    await registered();
    const verifyCode = lastCodeSentTo(account.email);
    const res = await request(app)
      .post('/api/auth/password/reset')
      .send({ email: account.email, code: verifyCode, password: 'garden-party-2026' });
    expect(res.statusCode).toBe(400);

    await requestReset();
    const weak = await request(app)
      .post('/api/auth/password/reset')
      .send({ email: account.email, code: lastCodeSentTo(account.email), password: 'password123' });
    expect(weak.statusCode).toBe(400);
    expect(weak.body.message).toMatch(/too easy to guess/);
  });

  test('requests are limited per email', async () => {
    await registered();
    for (let i = 0; i < 3; i++) await requestReset();
    expect((await request(app).post('/api/auth/password/forgot').send({ email: account.email })).statusCode).toBe(429);
  });
});
