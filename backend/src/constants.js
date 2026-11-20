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

// Eventbrite's category names (GET /v3/categories). Every event's `eventCategory` is one of these,
// whichever provider it came from: Luma feeds have no categories, so each Luma source is assigned one.
// Keeping one list means the app's category filters work the same for every source.
const EVENT_CATEGORIES = [
  'Music',
  'Business & Professional',
  'Food & Drink',
  'Community & Culture',
  'Performing & Visual Arts',
  'Film, Media & Entertainment',
  'Sports & Fitness',
  'Health & Wellness',
  'Science & Technology',
  'Travel & Outdoor',
  'Charity & Causes',
  'Religion & Spirituality',
  'Family & Education',
  'Seasonal & Holiday',
  'Government & Politics',
  'Fashion & Beauty',
  'Home & Lifestyle',
  'Auto, Boat & Air',
  'Hobbies & Special Interest',
  'Other',
  'School Activities',
];

// Display names for the app ("Open in Eventbrite" / "Open in Luma")
const PROVIDER_NAMES = { EVENTBRITE: 'Eventbrite', LUMA: 'Luma' };

module.exports = {
  ACTIVITY_TYPES,
  INTEREST_OPTIONS,
  METRO_AREAS,
  DEFAULT_METRO_AREA,
  EVENT_CATEGORIES,
  PROVIDER_NAMES,
};
