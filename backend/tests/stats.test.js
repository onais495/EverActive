jest.mock('../src/services/gemini');

const request = require('supertest');
const app = require('../src/app');
const gemini = require('../src/services/gemini');
const { signUp, seedEvent } = require('./helpers/factories');

describe('GET /api/admin/stats', () => {
  test('returns grouped counts only, never anything about an individual', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const user = await signUp();
    await request(app).put('/api/interests').set(user.auth).send({ interests: ['Gardens', 'Museums'], custom: ['my secret hobby'] });
    await seedEvent({ eventCategory: 'Music', category: 'Social' });
    await seedEvent({ eventCategory: 'Music', category: 'Solo', provider: 'LUMA', externalId: 'evt-1' });
    await seedEvent({ eventCategory: null, category: 'Intellectual' });
    gemini.generateJson.mockRejectedValue(new Error('down'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app).post('/api/plans/current/generate').set(user.auth);

    const res = await request(app).get('/api/admin/stats').set(admin.auth);
    expect(res.statusCode).toBe(200);
    expect(res.body.users).toEqual({ total: 2, active: 2, emailVerified: 0, joinedLast7Days: 2 });
    expect(res.body.plans).toMatchObject({ usersWithPlanThisWeek: 1, activitiesThisWeek: { suggested: 3, attended: 0, notInterested: 0 } });
    expect(res.body.events.next7Days).toEqual({
      byProvider: { EVENTBRITE: 2, LUMA: 1 },
      byEventCategory: { Music: 2, Uncategorized: 1 },
      byActivityType: { Social: 1, Solo: 1, Intellectual: 1 },
    });
    expect(res.body.interests.byOption).toMatchObject({ Gardens: 1, Museums: 1, Broadway: 0 });
    expect(res.body.interests.customTotal).toBe(1);

    const text = JSON.stringify(res.body);
    for (const secret of [user.user.email, user.user.nameLast, 'secret hobby']) expect(text).not.toContain(secret);
    console.warn.mockRestore();
  });

  test('is for admins only', async () => {
    const { auth } = await signUp();
    expect((await request(app).get('/api/admin/stats').set(auth)).statusCode).toBe(403);
  });
});

describe('admin account management (US011)', () => {
  test('lists users with names and emails only, newest first, in pages', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const user = await signUp();
    await request(app).put('/api/interests').set(user.auth).send({ interests: ['Gardens'] });
    const res = await request(app).get('/api/admin/users').set(admin.auth);
    expect(res.body).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(Object.keys(res.body.users[0]).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'nameFirst', 'nameLast', 'role']);
    expect(JSON.stringify(res.body)).not.toMatch(/Gardens|password/);
    expect((await request(app).get('/api/admin/users?page=2').set(admin.auth)).body.users).toEqual([]);
  });

  test('deactivating logs the user out everywhere; reactivating lets them back in', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const user = await signUp();
    const res = await request(app).patch(`/api/admin/users/${user.user.id}`).set(admin.auth).send({ isActive: false });
    expect(res.statusCode).toBe(200);
    expect((await request(app).get('/api/auth/me').set(user.auth)).statusCode).toBe(401);

    await request(app).patch(`/api/admin/users/${user.user.id}`).set(admin.auth).send({ isActive: true });
    const login = await request(app).post('/api/auth/login').send({ email: user.user.email, password: 'retired2025' });
    expect(login.statusCode).toBe(200);
  });

  test('guards: no self-deactivation, valid input, admins only', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const { auth } = await signUp();
    expect((await request(app).patch(`/api/admin/users/${admin.user.id}`).set(admin.auth).send({ isActive: false })).statusCode).toBe(400);
    expect((await request(app).patch('/api/admin/users/99999').set(admin.auth).send({ isActive: false })).statusCode).toBe(404);
    expect((await request(app).patch(`/api/admin/users/${admin.user.id}`).set(admin.auth).send({ isActive: 'no' })).statusCode).toBe(400);
    expect((await request(app).get('/api/admin/users').set(auth)).statusCode).toBe(403);
  });
});

describe('engagement stats (US010)', () => {
  test('attendance rate, most attended activity types and average ratings, grouped only', async () => {
    const admin = await signUp({ role: 'ADMIN' });
    const user = await signUp();
    const fakeDb = require('./helpers/fakeDb');
    const item = (status, category, rating = null) =>
      fakeDb.planItem.create({
        data: { userId: user.user.id, eventId: 1, weekStart: new Date(Date.now() + Math.random() * 1e9), category, reason: '', status, rating, respondedAt: new Date() },
      });
    await item('ATTENDED', 'Social', 5);
    await item('ATTENDED', 'Social', 3);
    await item('ATTENDED', 'Intellectual');
    await item('SKIPPED', 'Solo');

    const { engagement } = (await request(app).get('/api/admin/stats').set(admin.auth)).body;
    expect(engagement).toMatchObject({
      attended: 3,
      didntGo: 1,
      attendanceRate: 0.75,
      mostAttendedActivityTypes: [
        { activityType: 'Social', attended: 2 },
        { activityType: 'Intellectual', attended: 1 },
      ],
      averageRatingByActivityType: { Social: { average: 4, ratings: 2 } },
      nudgesLast7Days: { sent: 0, emailed: 0 },
    });
  });
});
