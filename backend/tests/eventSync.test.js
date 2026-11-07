jest.mock('../src/services/eventbrite');

const request = require('supertest');
const app = require('../src/app');
const eventbrite = require('../src/services/eventbrite');
const fakeDb = require('./helpers/fakeDb');
const { signUp, HOUR } = require('./helpers/factories');
const { toCachedEvent } = require('../src/services/eventSync');

const source = { id: 1, name: 'Museum Talks', metroArea: 'NYC', defaultCategory: 'Intellectual' };
const now = new Date();

function rawEvent(overrides = {}) {
  return {
    id: '1001',
    name: { text: 'Lecture on Impressionism' },
    summary: 'An evening talk.',
    url: 'https://www.eventbrite.com/e/1001',
    start: { utc: new Date(now.getTime() + 48 * HOUR).toISOString() },
    end: { utc: new Date(now.getTime() + 50 * HOUR).toISOString() },
    online_event: false,
    is_free: true,
    venue: {
      name: 'The Met',
      address: { latitude: '40.7794', longitude: '-73.9632', localized_address_display: '1000 5th Ave, New York' },
    },
    ...overrides,
  };
}

describe('toCachedEvent: NYC filtering', () => {
  test('keeps an in-person NYC event and maps its fields', () => {
    expect(toCachedEvent(rawEvent(), source, now)).toMatchObject({
      eventbriteId: '1001',
      title: 'Lecture on Impressionism',
      category: 'Intellectual',
      venueName: 'The Met',
      latitude: 40.7794,
      isFree: true,
    });
  });

  test('keeps only the source organizer’s events when one is set', () => {
    const narrowed = { ...source, eventbriteOrganizerId: '42' };
    expect(toCachedEvent(rawEvent({ organizer_id: '42' }), narrowed, now)).not.toBeNull();
    expect(toCachedEvent(rawEvent({ organizer_id: '99' }), narrowed, now)).toBeNull();
  });

  test.each([
    ['online events', { online_event: true }],
    ['events with no venue', { venue: null }],
    ['events outside NYC (Philadelphia)', { venue: { address: { latitude: '39.95', longitude: '-75.16' } } }],
    ['events with missing coordinates', { venue: { address: { latitude: null, longitude: null } } }],
    ['events in the past', { start: { utc: new Date(now.getTime() - HOUR).toISOString() } }],
    ['events more than 30 days out', { start: { utc: new Date(now.getTime() + 40 * 24 * HOUR).toISOString() } }],
  ])('drops %s', (_, overrides) => {
    expect(toCachedEvent(rawEvent(overrides), source, now)).toBeNull();
  });
});

describe('admin event sources and sync', () => {
  let admin;
  beforeEach(async () => {
    eventbrite.listVenueEvents.mockReset();
    eventbrite.getEvent.mockReset();
    admin = await signUp({ role: 'ADMIN' });
  });

  test('regular users are blocked from admin endpoints', async () => {
    const { auth } = await signUp();
    expect((await request(app).get('/api/admin/event-sources').set(auth)).statusCode).toBe(403);
    expect((await request(app).post('/api/admin/event-sync').set(auth)).statusCode).toBe(403);
  });

  test('adds a source from a sample event ID by looking up its venue and organizer', async () => {
    eventbrite.getEvent.mockResolvedValue({ id: '555', venue_id: '777', organizer_id: '42', online_event: false });
    const res = await request(app)
      .post('/api/admin/event-sources')
      .set(admin.auth)
      .send({ name: 'Museum Talks', defaultCategory: 'Intellectual', eventId: '555' });

    expect(res.statusCode).toBe(201);
    expect(res.body.source).toMatchObject({
      eventbriteVenueId: '777',
      eventbriteOrganizerId: '42',
      defaultCategory: 'Intellectual',
    });
  });

  test('rejects online-only sample events', async () => {
    eventbrite.getEvent.mockResolvedValue({ id: '555', venue_id: null, online_event: true });
    const res = await request(app)
      .post('/api/admin/event-sources')
      .set(admin.auth)
      .send({ name: 'Webinars', defaultCategory: 'Intellectual', eventId: '555' });
    expect(res.statusCode).toBe(400);
  });

  test('rejects duplicates and bad input', async () => {
    const body = { name: 'Jazz Club', defaultCategory: 'Social', venueId: '123' };
    expect((await request(app).post('/api/admin/event-sources').set(admin.auth).send(body)).statusCode).toBe(201);
    expect((await request(app).post('/api/admin/event-sources').set(admin.auth).send(body)).statusCode).toBe(409);

    const bad = [
      { ...body, venueId: '12; DROP TABLE' },
      { ...body, defaultCategory: 'Party' },
      { name: 'Both IDs', defaultCategory: 'Social', venueId: '1', eventId: '2' },
    ];
    for (const b of bad) {
      expect((await request(app).post('/api/admin/event-sources').set(admin.auth).send(b)).statusCode).toBe(400);
    }
  });

  test('sync caches filtered events, updates existing ones, and survives a failing source', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    await fakeDb.eventSource.create({ data: { name: 'Museum Talks', eventbriteVenueId: '777', defaultCategory: 'Intellectual' } });
    await fakeDb.eventSource.create({ data: { name: 'Broken Venue', eventbriteVenueId: '888', defaultCategory: 'Social' } });
    eventbrite.listVenueEvents.mockImplementation(async (venueId) => {
      if (venueId === '888') throw new Error('HTTP 404');
      return [rawEvent(), rawEvent({ id: '1002', online_event: true })];
    });

    let res = await request(app).post('/api/admin/event-sync').set(admin.auth);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ name: 'Museum Talks', fetched: 2, saved: 1 }),
      expect.objectContaining({ name: 'Broken Venue', error: 'HTTP 404' }),
    ]);
    expect(fakeDb.events).toHaveLength(1);

    // A second sync updates the cached event instead of duplicating it
    eventbrite.listVenueEvents.mockResolvedValue([rawEvent({ name: { text: 'Renamed lecture' } })]);
    res = await request(app).post('/api/admin/event-sync').set(admin.auth);
    expect(fakeDb.events).toHaveLength(1);
    expect(fakeDb.events[0].title).toBe('Renamed lecture');
    warn.mockRestore();
  });

  test('can pause a source', async () => {
    const created = await request(app)
      .post('/api/admin/event-sources')
      .set(admin.auth)
      .send({ name: 'Jazz Club', defaultCategory: 'Social', venueId: '123' });
    const res = await request(app)
      .patch(`/api/admin/event-sources/${created.body.source.id}`)
      .set(admin.auth)
      .send({ isActive: false });
    expect(res.body.source.isActive).toBe(false);
  });
});
