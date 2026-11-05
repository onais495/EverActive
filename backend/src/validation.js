const { ACTIVITY_TYPES, INTEREST_OPTIONS, METRO_AREAS } = require('./constants');

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

// Body: { name, defaultCategory, organizationId? , eventId? } — one of the two IDs is required
function validateEventSource(body) {
  const { name, defaultCategory, organizationId, eventId } = body;
  const errors = [];

  if (!isNonEmptyString(name) || name.trim().length > 100) errors.push('Please give the source a name.');
  if (!ACTIVITY_TYPES.includes(defaultCategory)) {
    errors.push(`Category must be one of: ${ACTIVITY_TYPES.join(', ')}.`);
  }
  const orgId = organizationId === undefined ? undefined : String(organizationId);
  const sampleEventId = eventId === undefined ? undefined : String(eventId);
  if ((orgId === undefined) === (sampleEventId === undefined)) {
    errors.push('Provide either organizationId or eventId.');
  } else if (!EVENTBRITE_ID_PATTERN.test(orgId ?? sampleEventId)) {
    errors.push('Eventbrite IDs are numbers only.');
  }

  if (errors.length > 0) return { errors };
  return { data: { name: name.trim(), defaultCategory, organizationId: orgId, eventId: sampleEventId } };
}

module.exports = {
  validateRegistration,
  validateInterests,
  validatePreferences,
  validateEventSource,
  normalizeEmail,
};
