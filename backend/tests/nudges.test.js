// Behavioral Nudging System (US009). Email is mocked in setup.js; push is mocked here.
jest.mock('../src/services/push', () => ({
  ...jest.requireActual('../src/services/push'),
  sendPush: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { signUp, seedEvent, HOUR } = require('./helpers/factories');
const { sendEmail } = require('../src/services/email');
const { sendPush } = require('../src/services/push');
const { runNudges, nudgeFor } = require('../src/services/nudges');
const { localDateAndHour } = require('../src/jobs/nudgeJob');

const DAY = 24 * HOUR;

beforeEach(() => {
  sendPush.mockReset().mockResolvedValue(0);
});

// A user who joined `days` ago, with a confirmed email unless told otherwise
async function userWhoJoined(days, { verified = true, interests } = {}) {
  const account = await signUp();
  account.user.createdAt = new Date(Date.now() - days * DAY);
  if (verified) account.user.emailVerifiedAt = new Date();
  if (interests) await request(app).put('/api/interests').set(account.auth).send({ interests });
  sendEmail.mockClear();
  return account;
}

async function attendedSocial(user, daysAgo) {
  const event = await seedEvent({ title: `Past mixer ${daysAgo}`, category: 'Social', startsAt: new Date(Date.now() - daysAgo * DAY) });
  return fakeDb.planItem.create({
    data: { userId: user.id, eventId: event.id, weekStart: new Date(), category: 'Social', reason: '', status: 'ATTENDED' },
  });
}

describe('who gets a nudge', () => {
  test('someone with no social outing in over a week, when there is a social event to suggest', async () => {
    const { user } = await userWhoJoined(10);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    const nudge = await nudgeFor(user);
    expect(nudge).toMatchObject({ kind: 'SOCIAL_GAP' });
    expect(nudge.message).toMatch(/^You haven't been to a social event with EverActive yet\./);
    expect(nudge.message).toContain('"Jazz night"');
  });

  test('not someone who went to a social activity in the last 7 days', async () => {
    const { user } = await userWhoJoined(30);
    await attendedSocial(user, 3);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect(await nudgeFor(user)).toBeNull();
  });

  test('counts the days since the last social outing', async () => {
    const { user } = await userWhoJoined(30);
    await attendedSocial(user, 9);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect((await nudgeFor(user)).message).toMatch(/^It's been 9 days since your last social outing\./);
  });

  test('new users get a week to settle in', async () => {
    const { user } = await userWhoJoined(2);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect(await nudgeFor(user)).toBeNull();
  });

  test('no nudge when there is nothing social coming up, or only unsuitable / unwanted events', async () => {
    const { user } = await userWhoJoined(10);
    await seedEvent({ title: 'Quiet gallery', category: 'Solo' });
    await seedEvent({ title: 'Club night', category: 'Social', isSuitable: false });
    await seedEvent({ title: 'Too far ahead', category: 'Social', startsAt: new Date(Date.now() + 9 * DAY) });
    const unwanted = await seedEvent({ title: 'Speed networking', category: 'Social' });
    await fakeDb.planItem.create({
      data: { userId: user.id, eventId: unwanted.id, weekStart: new Date(), category: 'Social', reason: '', status: 'NOT_INTERESTED' },
    });
    expect(await nudgeFor(user)).toBeNull();
  });

  test('at most one nudge every 3 days', async () => {
    await userWhoJoined(10);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect((await runNudges()).nudged).toBe(1);
    expect((await runNudges()).nudged).toBe(0);
    fakeDb.nudges[0].createdAt = new Date(Date.now() - 4 * DAY);
    expect((await runNudges()).nudged).toBe(1);
  });

  test('deactivated users are left alone', async () => {
    const { user } = await userWhoJoined(10);
    user.isActive = false;
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect((await runNudges()).nudged).toBe(0);
  });
});

describe('what the nudge says', () => {
  test('suggests an event already in their plan first, and says so', async () => {
    const { user } = await userWhoJoined(10);
    await seedEvent({ title: 'Other mixer', category: 'Social' });
    const planned = await seedEvent({ title: 'Book club social', category: 'Social' });
    await fakeDb.planItem.create({
      data: { userId: user.id, eventId: planned.id, weekStart: new Date(), category: 'Social', reason: '', status: 'SUGGESTED' },
    });
    const { message } = await nudgeFor(user);
    expect(message).toMatch(/"Book club social" on \w+day at .+ It's already in your plan for this week\. Or try "Other mixer"/);
  });

  test('ties the suggestion to an interest when one matches', async () => {
    const { user } = await userWhoJoined(10, { interests: ['Live music'] });
    await seedEvent({ title: 'Neighborhood mixer', category: 'Social' });
    await seedEvent({ title: 'Jazz night', category: 'Social', startsAt: new Date(Date.now() + 5 * DAY) });
    expect((await nudgeFor(user)).message).toMatch(/Since you like live music, "Jazz night" on/);
  });

  test('shortens very long event titles', async () => {
    const { user } = await userWhoJoined(10);
    await seedEvent({ title: 'x'.repeat(150), category: 'Social' });
    const { message } = await nudgeFor(user);
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain('…');
  });
});

describe('delivery', () => {
  test('emails confirmed users with a one-tap unsubscribe link, and pushes to their phones', async () => {
    process.env.PUBLIC_URL = 'https://everactive.example';
    const { user } = await userWhoJoined(10);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    sendPush.mockResolvedValue(1);

    expect(await runNudges()).toMatchObject({ nudged: 1, emailed: 1, pushed: 1 });
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(user.email);
    expect(mail.text).toMatch(/^Hi Test,/);
    const link = mail.text.match(/https:\/\/everactive\.example\/api\/nudges\/unsubscribe\?token=[a-f0-9]{48}/)[0];
    expect(mail.headers['List-Unsubscribe']).toBe(`<${link}>`);
    expect(sendPush.mock.calls[0][1]).toMatchObject({ title: 'Time to get out?', data: { screen: 'plan' } });
    expect(fakeDb.nudges[0].emailedAt).toBeInstanceOf(Date);

    // The link works without logging in, and turns the emails off
    const res = await request(app).get(link.replace('https://everactive.example', ''));
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('unsubscribed');
    expect(fakeDb.users.find((u) => u.id === user.id).nudgeEmails).toBe(false);
    delete process.env.PUBLIC_URL;
  });

  test('no email to unconfirmed addresses or to people who turned emails off; the in-app nudge still happens', async () => {
    const unconfirmed = await userWhoJoined(10, { verified: false });
    const optedOut = await userWhoJoined(10);
    await request(app).put('/api/preferences').set(optedOut.auth).send({ nudgeEmails: false });
    await seedEvent({ title: 'Jazz night', category: 'Social' });

    expect(await runNudges()).toMatchObject({ nudged: 2, emailed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await request(app).get('/api/nudges/current').set(unconfirmed.auth)).body.nudge).not.toBeNull();
  });

  test('a failing email or push service never stops the nudge', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await userWhoJoined(10);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    sendEmail.mockRejectedValue(new Error('Brevo 500'));
    sendPush.mockRejectedValue(new Error('Expo down'));
    expect(await runNudges()).toMatchObject({ nudged: 1, emailed: 0, pushed: 0, failed: 0 });
    error.mockRestore();
  });

  test('a bad unsubscribe token gets the same page and changes nothing', async () => {
    const res = await request(app).get('/api/nudges/unsubscribe?token=nope');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('unsubscribed');
  });
});

describe('in the app', () => {
  test('GET /api/nudges/current shows the latest nudge with its events, until dismissed', async () => {
    const { auth } = await userWhoJoined(10);
    const jazz = await seedEvent({ title: 'Jazz night', category: 'Social' });
    expect((await request(app).get('/api/nudges/current').set(auth)).body).toEqual({ nudge: null });

    await runNudges();
    const res = await request(app).get('/api/nudges/current').set(auth);
    expect(res.body.nudge).toMatchObject({ kind: 'SOCIAL_GAP', message: expect.any(String) });
    expect(res.body.nudge.events[0]).toMatchObject({ eventId: jazz.id, title: 'Jazz night', day: expect.any(String), planItemId: null });
    expect(fakeDb.nudges[0].seenAt).toBeInstanceOf(Date);

    const dismissed = await request(app).post(`/api/nudges/${res.body.nudge.id}/dismiss`).set(auth);
    expect(dismissed.statusCode).toBe(200);
    expect((await request(app).get('/api/nudges/current').set(auth)).body.nudge).toBeNull();
  });

  test("users can't see or dismiss each other's nudges", async () => {
    await userWhoJoined(10);
    await seedEvent({ title: 'Jazz night', category: 'Social' });
    await runNudges();
    const stranger = await signUp();
    expect((await request(app).get('/api/nudges/current').set(stranger.auth)).body.nudge).toBeNull();
    expect((await request(app).post(`/api/nudges/${fakeDb.nudges[0].id}/dismiss`).set(stranger.auth)).statusCode).toBe(404);
  });

  test('the email setting is part of preferences', async () => {
    const { auth } = await signUp();
    expect((await request(app).get('/api/preferences').set(auth)).body.nudgeEmails).toBe(true);
    const res = await request(app).put('/api/preferences').set(auth).send({ nudgeEmails: false });
    expect(res.body.nudgeEmails).toBe(false);
    expect((await request(app).put('/api/preferences').set(auth).send({ nudgeEmails: 'no' })).statusCode).toBe(400);
  });
});

describe('push devices', () => {
  const token = 'ExponentPushToken[abc123XYZ]';

  test('registers, moves between accounts, and removes a push token', async () => {
    const first = await signUp();
    const second = await signUp();
    expect((await request(app).post('/api/devices').set(first.auth).send({ pushToken: token, platform: 'ios' })).statusCode).toBe(200);
    await request(app).post('/api/devices').set(second.auth).send({ pushToken: token, platform: 'ios' });
    expect(fakeDb.devices).toHaveLength(1);
    expect(fakeDb.devices[0].userId).toBe(second.user.id);

    await request(app).delete('/api/devices').set(second.auth).send({ pushToken: token });
    expect(fakeDb.devices).toHaveLength(0);
  });

  test('rejects anything that is not an Expo push token', async () => {
    const { auth } = await signUp();
    for (const body of [{ pushToken: 'hello', platform: 'ios' }, { pushToken: token, platform: 'windows' }, {}]) {
      expect((await request(app).post('/api/devices').set(auth).send(body)).statusCode).toBe(400);
    }
  });
});

describe('the daily job', () => {
  test('works out the New York date and hour', () => {
    // 15:00 UTC on Nov 20 is 10:00 in New York (EST)
    expect(localDateAndHour(new Date('2026-11-20T15:00:00Z'), 'America/New_York')).toEqual({ date: '2026-11-20', hour: 10 });
  });

  test('admins can run it on demand; regular users cannot', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const { auth } = await signUp();
    expect((await request(app).post('/api/admin/nudges/run').set(auth)).statusCode).toBe(403);
    const res = await request(app).post('/api/admin/nudges/run').set(admin.auth);
    expect(res.body.summary).toMatchObject({ checked: 2, nudged: 0 });
  });
});
