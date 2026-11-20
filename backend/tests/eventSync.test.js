jest.mock('../src/services/eventbrite');
jest.mock('../src/services/luma', () => ({
  ...jest.requireActual('../src/services/luma'),
  listCalendarEvents: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const eventbrite = require('../src/services/eventbrite');
const luma = require('../src/services/luma');
const fakeDb = require('./helpers/fakeDb');
const { signUp, HOUR } = require('./helpers/factories');
const { toCachedEvent, toCachedLumaEvent } = require('../src/services/eventSync');

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
      provider: 'EVENTBRITE',
      externalId: '1001',
      title: 'Lecture on Impressionism',
      category: 'Intellectual',
      eventCategory: null,
      venueName: 'The Met',
      latitude: 40.7794,
      isFree: true,
    });
  });

  test('keeps only the source organizer’s events when one is set', () => {
    const narrowed = { ...source, organizerId: '42' };
    expect(toCachedEvent(rawEvent({ organizer_id: '42' }), narrowed, now)).not.toBeNull();
    expect(toCachedEvent(rawEvent({ organizer_id: '99' }), narrowed, now)).toBeNull();
  });

  test('takes eventCategory from Eventbrite, falling back to the source’s', () => {
    const withCategory = rawEvent({ category: { id: '103', name: 'Music' } });
    expect(toCachedEvent(withCategory, source, now).eventCategory).toBe('Music');
    const fallback = { ...source, defaultEventCategory: 'Community & Culture' };
    expect(toCachedEvent(rawEvent(), fallback, now).eventCategory).toBe('Community & Culture');
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
      provider: 'EVENTBRITE',
      externalId: '777',
      organizerId: '42',
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
      { ...body, defaultEventCategory: 'Parties' },
      { ...body, provider: 'MEETUP' },
    ];
    for (const b of bad) {
      expect((await request(app).post('/api/admin/event-sources').set(admin.auth).send(b)).statusCode).toBe(400);
    }
  });

  test('sync caches filtered events, updates existing ones, and survives a failing source', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    await fakeDb.eventSource.create({ data: { name: 'Museum Talks', externalId: '777', defaultCategory: 'Intellectual' } });
    await fakeDb.eventSource.create({ data: { name: 'Broken Venue', externalId: '888', defaultCategory: 'Social' } });
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

// A Luma iCal feed, shaped like the real one (folded lines, escaped text, GEO, Luma's DESCRIPTION layout)
function lumaFeed(events) {
  const ics = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = events
    .map((e) =>
      [
        'BEGIN:VEVENT',
        `DTSTART:${ics(e.start)}`,
        `DTEND:${ics(new Date(e.start.getTime() + 2 * HOUR))}`,
        'ORGANIZER;CN="Garden Club: NYC":MAILTO:calendar-invite@lu.ma',
        `UID:${e.id}@events.lu.ma`,
        `SUMMARY:${e.title}`,
        // Folded mid-word, the way Luma folds at 75 bytes
        'DESCRIPTION:Get up-to-date information at: https://luma.com/abc123\\n\\nAd',
        ' dress:\\nBrooklyn Botanic Garden\\nBrooklyn\\, NY\\n\\nA guided walk through the ros',
        ' e garden.\\n\\nHosted by Garden Club',
        'LOCATION:Brooklyn Botanic Garden\\, 990 Washington Ave\\, Brooklyn\\, NY 11225',
        e.geo === null ? null : `GEO:${e.geo || '40.6676;-73.9632'}`,
        'STATUS:TENTATIVE',
        'END:VEVENT',
      ]
        .filter(Boolean)
        .join('\r\n')
    )
    .join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

describe('Luma iCal feeds', () => {
  const lumaSource = {
    id: 2,
    provider: 'LUMA',
    externalId: 'cal-abc123',
    metroArea: 'NYC',
    defaultCategory: 'Solo',
    defaultEventCategory: 'Travel & Outdoor',
  };
  const soon = new Date(Math.floor((now.getTime() + 48 * HOUR) / 1000) * 1000);

  test('parses folded lines, escapes and coordinates, and maps Luma’s description layout', () => {
    const [raw] = luma.parseIcs(lumaFeed([{ id: 'evt-1', title: 'Rose garden walk', start: soon }]));
    expect(raw).toMatchObject({ uid: 'evt-1@events.lu.ma', summary: 'Rose garden walk', start: soon });

    expect(toCachedLumaEvent(raw, lumaSource, now)).toMatchObject({
      provider: 'LUMA',
      externalId: 'evt-1',
      title: 'Rose garden walk',
      description: 'A guided walk through the rose garden.',
      url: 'https://luma.com/abc123',
      venueName: 'Brooklyn Botanic Garden',
      address: 'Brooklyn Botanic Garden, 990 Washington Ave, Brooklyn, NY 11225',
      latitude: 40.6676,
      isFree: null,
      category: 'Solo',
      eventCategory: 'Travel & Outdoor',
    });
  });

  test('drops online, out-of-city, all-day, past and cancelled events', () => {
    const feed = lumaFeed([
      { id: 'evt-online', title: 'Webinar', start: soon, geo: null },
      { id: 'evt-philly', title: 'Philly walk', start: soon, geo: '39.95;-75.16' },
      { id: 'evt-past', title: 'Old walk', start: new Date(now.getTime() - 48 * HOUR) },
    ]).replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:evt-allday\r\nSUMMARY:Fair\r\nDTSTART;VALUE=DATE:20261201\r\nGEO:40.7;-73.9\r\nEND:VEVENT\r\nEND:VCALENDAR');
    const kept = luma.parseIcs(feed).map((r) => toCachedLumaEvent(r, lumaSource, now)).filter(Boolean);
    expect(kept).toEqual([]);

    const [cancelled] = luma.parseIcs(lumaFeed([{ id: 'evt-x', title: 'Walk', start: soon }]));
    expect(toCachedLumaEvent({ ...cancelled, status: 'CANCELLED' }, lumaSource, now)).toBeNull();
  });

  test('finds the calendar ID in a pasted iCal link', () => {
    expect(luma.extractCalendarId('https://api.lu.ma/ics/get?entity=calendar&id=cal-tvsAmdeHDeDIXW2')).toBe('cal-tvsAmdeHDeDIXW2');
    expect(luma.extractCalendarId('https://luma.com/nyc')).toBeNull();
  });

  describe('admin', () => {
    let admin;
    beforeEach(async () => {
      luma.listCalendarEvents.mockReset();
      admin = await signUp({ role: 'ADMIN' });
    });

    test('adds a Luma calendar by its iCal link, after checking the feed loads', async () => {
      luma.listCalendarEvents.mockResolvedValue([]);
      const res = await request(app).post('/api/admin/event-sources').set(admin.auth).send({
        provider: 'LUMA',
        name: 'Garden Club',
        defaultCategory: 'Solo',
        defaultEventCategory: 'Travel & Outdoor',
        calendar: 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc123',
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.source).toMatchObject({ provider: 'LUMA', externalId: 'cal-abc123', defaultEventCategory: 'Travel & Outdoor' });
      expect(luma.listCalendarEvents).toHaveBeenCalledWith('cal-abc123');
    });

    test('requires a category for Luma sources and rejects calendars that don’t load', async () => {
      const body = { provider: 'LUMA', name: 'Garden Club', defaultCategory: 'Solo', calendar: 'cal-abc123' };
      expect((await request(app).post('/api/admin/event-sources').set(admin.auth).send(body)).statusCode).toBe(400);

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      luma.listCalendarEvents.mockRejectedValue(new Error('HTTP 404'));
      const res = await request(app)
        .post('/api/admin/event-sources')
        .set(admin.auth)
        .send({ ...body, defaultEventCategory: 'Travel & Outdoor' });
      expect(res.statusCode).toBe(400);
      warn.mockRestore();
    });

    test('syncs Luma and Eventbrite sources side by side', async () => {
      await fakeDb.eventSource.create({ data: lumaSource });
      await fakeDb.eventSource.create({ data: { name: 'Museum Talks', externalId: '777', defaultCategory: 'Intellectual' } });
      luma.listCalendarEvents.mockResolvedValue(luma.parseIcs(lumaFeed([{ id: 'evt-1', title: 'Rose garden walk', start: soon }])));
      eventbrite.listVenueEvents.mockResolvedValue([rawEvent({ category: { name: 'Community & Culture' } })]);

      await request(app).post('/api/admin/event-sync').set(admin.auth);
      expect(fakeDb.events.map((e) => [e.provider, e.eventCategory]).sort()).toEqual([
        ['EVENTBRITE', 'Community & Culture'],
        ['LUMA', 'Travel & Outdoor'],
      ]);
    });

    test('can change a source’s event category', async () => {
      const source = await fakeDb.eventSource.create({ data: lumaSource });
      const res = await request(app)
        .patch(`/api/admin/event-sources/${source.id}`)
        .set(admin.auth)
        .send({ defaultEventCategory: 'Music' });
      expect(res.body.source.defaultEventCategory).toBe('Music');
      const bad = await request(app).patch(`/api/admin/event-sources/${source.id}`).set(admin.auth).send({ defaultEventCategory: 'Raves' });
      expect(bad.statusCode).toBe(400);
    });
  });
});
