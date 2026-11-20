// Shortcuts for setting up test data
const request = require('supertest');
const app = require('../../src/app');
const fakeDb = require('./fakeDb');

const HOUR = 60 * 60 * 1000;
let userCount = 0;

// Registers through the real endpoint and returns { token, user, auth } where auth is the header
async function signUp({ role } = {}) {
  userCount++;
  const res = await request(app).post('/api/auth/register').send({
    nameFirst: 'Test',
    nameLast: `User${userCount}`,
    dateBirth: '1958-06-01',
    email: `user${userCount}@example.com`,
    password: 'retired2025',
  });
  const user = fakeDb.users.find((u) => u.id === res.body.user.id);
  if (role) user.role = role;
  return { token: res.body.token, user, auth: { Authorization: `Bearer ${res.body.token}` } };
}

let eventCount = 0;

async function seedEvent(overrides = {}) {
  eventCount++;
  return fakeDb.event.create({
    data: {
      provider: 'EVENTBRITE',
      externalId: `eb-${eventCount}`,
      sourceId: 1,
      title: `Event ${eventCount}`,
      description: 'An event in the city.',
      url: `https://www.eventbrite.com/e/${eventCount}`,
      // 10 minutes apart, so hundreds of events across a test run all stay inside the 7-day plan window
      startsAt: new Date(Date.now() + 24 * HOUR + eventCount * 10 * 60 * 1000),
      endsAt: null,
      venueName: 'Somewhere in Manhattan',
      address: '1 Main St, New York, NY',
      latitude: 40.75,
      longitude: -73.98,
      isFree: false,
      category: 'Social',
      eventCategory: null,
      metroArea: 'NYC',
      ...overrides,
    },
  });
}

module.exports = { signUp, seedEvent, HOUR };
