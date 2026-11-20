const { ACTIVITY_TYPES, INTEREST_OPTIONS, METRO_AREAS, EVENT_CATEGORIES } = require('./constants');
const { extractCalendarId, isCityFeed } = require('./services/luma');

const EMAIL_PATTERN =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX_LENGTH = 50;
const MIN_AGE = 18;
const MAX_AGE = 120;
// Length over composition rules, per current NIST guidance
const PASSWORD_MIN_LENGTH = 10;
// bcrypt ignores everything past 72 bytes
const PASSWORD_MAX_LENGTH = 72;

// Common passwords that are long enough to pass the length check
const COMMON_PASSWORDS = new Set([
  '0123456789', '1234567890', '12345678910', '1111111111', '0000000000',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t', 'abcdefghij',
  'password12', 'password123', 'password1234', 'passw0rd123', 'iloveyou12',
  'welcome123', 'letmein123', 'sunshine123', 'princess123', 'football123',
  'baseball123', 'monkey12345', 'dragon12345', 'trustno1234', 'everactive',
  'everactive1', 'everactive123',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function passwordError(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password) > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    return 'That password is too easy to guess. Please choose another.';
  }
  return null;
}

// Parses "YYYY-MM-DD" as a calendar date (UTC midnight, so it never shifts a day).
// Returns null for anything else, including impossible dates like 2025-02-30.
function parseCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function ageOn(birthDate, today) {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayPassed =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() >= birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age;
}

// Returns { errors } with plain-language messages, or { data } ready to save
function validateRegistration(body) {
  const { nameFirst, nameLast, dateBirth, email, password } = body;
  const errors = [];

  if (!isNonEmptyString(nameFirst) || nameFirst.trim().length > NAME_MAX_LENGTH) {
    errors.push('Please enter your first name.');
  }
  if (!isNonEmptyString(nameLast) || nameLast.trim().length > NAME_MAX_LENGTH) {
    errors.push('Please enter your last name.');
  }

  const birthDate = parseCalendarDate(dateBirth);
  const age = birthDate && ageOn(birthDate, new Date());
  if (!birthDate || age < MIN_AGE || age > MAX_AGE) {
    errors.push('Please enter a valid date of birth.');
  }

  if (!isNonEmptyString(email) || !EMAIL_PATTERN.test(email.trim())) {
    errors.push('Please enter a valid email address.');
  }

  const pwError = passwordError(password);
  if (pwError) errors.push(pwError);

  if (errors.length > 0) return { errors };

  return {
    data: {
      nameFirst: nameFirst.trim(),
      nameLast: nameLast.trim(),
      dateBirth: birthDate,
      email: normalizeEmail(email),
      password,
    },
  };
}

const MAX_CUSTOM_INTERESTS = 10;
const CUSTOM_INTEREST_MAX_LENGTH = 40;
// Letters (any language), numbers, spaces and light punctuation. Free text ends up in the
// LLM prompt, so anything that looks like markup or instructions is rejected outright.
const CUSTOM_INTEREST_PATTERN = /^[\p{L}\p{N} .,'&-]+$/u;

// Body: { interests: ['Broadway', ...], custom: ['bird watching', ...] }
function validateInterests(body) {
  const { interests = [], custom = [] } = body;
  if (!Array.isArray(interests) || !Array.isArray(custom)) {
    return { errors: ['Interests must be lists.'] };
  }

  const errors = [];
  const chosen = new Map();

  for (const name of interests) {
    if (!INTEREST_OPTIONS.includes(name)) {
      errors.push(`"${String(name).slice(0, 40)}" is not one of the interest options.`);
    } else {
      chosen.set(name.toLowerCase(), { name, isCustom: false });
    }
  }

  if (custom.length > MAX_CUSTOM_INTERESTS) {
    errors.push(`Please add at most ${MAX_CUSTOM_INTERESTS} interests of your own.`);
  }
  for (const raw of custom.slice(0, MAX_CUSTOM_INTERESTS)) {
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > CUSTOM_INTEREST_MAX_LENGTH || !CUSTOM_INTEREST_PATTERN.test(name)) {
      errors.push(`Interests you add must be 1 to ${CUSTOM_INTEREST_MAX_LENGTH} letters, numbers or spaces.`);
      break;
    }
    if (!chosen.has(name.toLowerCase())) chosen.set(name.toLowerCase(), { name, isCustom: true });
  }

  if (errors.length > 0) return { errors };
  if (chosen.size === 0) return { errors: ['Please choose at least one interest.'] };
  return { data: [...chosen.values()] };
}

// Body: { metroArea?: 'NYC', activityTypes?: ['Solo', 'Social'] }
function validatePreferences(body) {
  const { metroArea, activityTypes } = body;
  const errors = [];
  const data = {};

  if (metroArea !== undefined) {
    if (!Object.hasOwn(METRO_AREAS, metroArea)) errors.push('That city is not supported yet.');
    else data.metroArea = metroArea;
  }

  if (activityTypes !== undefined) {
    const valid =
      Array.isArray(activityTypes) &&
      activityTypes.length > 0 &&
      activityTypes.every((t) => ACTIVITY_TYPES.includes(t));
    if (!valid) errors.push(`Please choose at least one of: ${ACTIVITY_TYPES.join(', ')}.`);
    else data.activityTypes = [...new Set(activityTypes)];
  }

  if (errors.length > 0) return { errors };
  if (Object.keys(data).length === 0) return { errors: ['Nothing to update.'] };
  return { data };
}

const EVENTBRITE_ID_PATTERN = /^\d{1,20}$/;
const PROVIDERS = ['EVENTBRITE', 'LUMA'];

function eventCategoryError(value, required) {
  if (value === undefined || value === null) return required ? 'Please choose an eventCategory for this source.' : null;
  return EVENT_CATEGORIES.includes(value) ? null : `eventCategory must be one of: ${EVENT_CATEGORIES.join(', ')}.`;
}

// Body: { provider?, name, defaultCategory, defaultEventCategory?, aiScreened?, ... }
//   Eventbrite (default): eventId (any event there) or venueId
//   Luma: calendar (a calendar ID cal-..., a city feed ID discplace-..., or the iCal subscription link)
//   aiScreened: the AI decides which events suit our users and sets their categories. Always on for
//   Luma city feeds. Without it, defaultCategory is required, and for Luma defaultEventCategory too
//   (Luma feeds don't include categories).
function validateEventSource(body) {
  const { provider = 'EVENTBRITE', name, defaultCategory, defaultEventCategory, venueId, eventId, calendar } = body;
  if (!PROVIDERS.includes(provider)) return { errors: [`provider must be one of: ${PROVIDERS.join(', ')}.`] };
  if (body.aiScreened !== undefined && typeof body.aiScreened !== 'boolean') {
    return { errors: ['aiScreened must be true or false.'] };
  }

  const calendarId = provider === 'LUMA' ? extractCalendarId(calendar) : null;
  const aiScreened = Boolean(body.aiScreened || (calendarId && isCityFeed(calendarId)));

  const errors = [];
  if (!isNonEmptyString(name) || name.trim().length > 100) errors.push('Please give the source a name.');
  // Screened sources get each event's type from the AI; the default is only a placeholder
  if (!(aiScreened && defaultCategory === undefined) && !ACTIVITY_TYPES.includes(defaultCategory)) {
    errors.push(`Category must be one of: ${ACTIVITY_TYPES.join(', ')}.`);
  }
  const categoryError = eventCategoryError(defaultEventCategory, provider === 'LUMA' && !aiScreened);
  if (categoryError) errors.push(categoryError);

  const data = {
    provider,
    defaultCategory: defaultCategory ?? 'Social',
    defaultEventCategory: defaultEventCategory ?? null,
    aiScreened,
  };

  if (provider === 'LUMA') {
    data.calendarId = calendarId;
    if (!data.calendarId) {
      errors.push('Paste the Luma calendar ID (cal-...), city feed ID (discplace-...) or its iCal subscription link.');
    }
  } else {
    const venue = venueId === undefined ? undefined : String(venueId);
    const sampleEventId = eventId === undefined ? undefined : String(eventId);
    if ((venue === undefined) === (sampleEventId === undefined)) {
      errors.push('Provide either venueId or eventId.');
    } else if (!EVENTBRITE_ID_PATTERN.test(venue ?? sampleEventId)) {
      errors.push('Eventbrite IDs are numbers only.');
    }
    data.venueId = venue;
    data.eventId = sampleEventId;
  }

  if (errors.length > 0) return { errors };
  return { data: { ...data, name: name.trim() } };
}

// Body for PATCH: any of { isActive, defaultCategory, defaultEventCategory (null clears it) }
function validateEventSourceUpdate(body) {
  const { isActive, defaultCategory, defaultEventCategory } = body;
  const errors = [];
  const data = {};

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') errors.push('isActive must be true or false.');
    else data.isActive = isActive;
  }
  if (defaultCategory !== undefined) {
    if (!ACTIVITY_TYPES.includes(defaultCategory)) errors.push(`Category must be one of: ${ACTIVITY_TYPES.join(', ')}.`);
    else data.defaultCategory = defaultCategory;
  }
  if (defaultEventCategory !== undefined) {
    const error = defaultEventCategory === null ? null : eventCategoryError(defaultEventCategory, false);
    if (error) errors.push(error);
    else data.defaultEventCategory = defaultEventCategory;
  }

  if (errors.length > 0) return { errors };
  if (Object.keys(data).length === 0) {
    return { errors: ['Send isActive, defaultCategory or defaultEventCategory.'] };
  }
  return { data };
}

module.exports = {
  validateRegistration,
  validateInterests,
  validatePreferences,
  validateEventSource,
  validateEventSourceUpdate,
  passwordError,
  normalizeEmail,
};
