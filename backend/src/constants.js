// Values shared by the API and the app. Category names match mobile/src/data/activities.ts.
const ACTIVITY_TYPES = ['Solo', 'Social', 'Intellectual'];

// Matches the onboarding chips in mobile/src/data/activities.ts (INTERESTS)
const INTEREST_OPTIONS = [
  'Broadway',
  'Gardens',
  'Markets',
  'Museums',
  'Sports',
  'Book clubs',
  'Alumni events',
  'Live music',
];

// Supported metro areas. Bounds keep events inside the city; Eventbrite's city
// field is inconsistent ("Brooklyn" vs "New York" vs "Astoria"), coordinates aren't.
const METRO_AREAS = {
  NYC: {
    label: 'New York City',
    timeZone: 'America/New_York',
    bounds: { minLat: 40.49, maxLat: 40.92, minLng: -74.26, maxLng: -73.7 },
  },
};

const DEFAULT_METRO_AREA = 'NYC';

module.exports = { ACTIVITY_TYPES, INTEREST_OPTIONS, METRO_AREAS, DEFAULT_METRO_AREA };
