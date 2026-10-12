const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

module.exports = { validateRegistration, normalizeEmail };
