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
