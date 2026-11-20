// Works out which of a user's interests an event relates to, and phrases them for reasons
// ("We picked this for you because you like gardens"). Used to check the AI's answer and by the
// rules fallback, so matching has to be better than "does the title contain the word Gardens".

// Each word must start at a word boundary, so "garden" matches "gardening" but "art" doesn't match "party"
const OPTION_KEYWORDS = {
  Broadway: ['broadway', 'theat(er|re)', 'musicals?\\b', 'plays?\\b', 'stage', 'drama'],
  Gardens: ['garden', 'botanic', 'horticult', 'plants?\\b', 'flower', 'greenhouse', 'arboretum', 'bloom'],
  Markets: ['markets?\\b', 'invest', 'stocks?\\b', 'financ', 'econom', 'wall street', 'bazaar', 'flea'],
  Museums: ['museum', 'galler', 'exhibit', 'arts?\\b', 'artists?\\b', 'curat', 'sculpt', 'painting'],
  Sports: ['sports?\\b', 'baseball', 'basketball', 'football', 'soccer', 'tennis', 'golf', 'hockey', 'yankees', 'mets\\b', 'knicks'],
  'Book clubs': ['book', 'authors?\\b', 'novel', 'literar', 'poet', 'reading'],
  'Alumni events': ['alumn', 'reunion', 'universit', 'college'],
  'Live music': ['music', 'concert', 'jazz', 'orchestra', 'symphon', 'choir', 'choral', 'opera', 'recital', 'quartet', 'band\\b', 'live set'],
};

// Provider categories that imply an interest even when the text doesn't say so
const CATEGORY_INTERESTS = {
  Music: ['Live music'],
  'Sports & Fitness': ['Sports'],
  'Performing & Visual Arts': ['Broadway', 'Museums'],
  'Business & Professional': ['Markets'],
};

// How each option reads inside a sentence
const OPTION_PHRASES = {
  Broadway: 'Broadway',
  Gardens: 'gardens',
  Markets: 'markets',
  Museums: 'museums',
  Sports: 'sports',
  'Book clubs': 'book clubs',
  'Alumni events': 'alumni events',
  'Live music': 'live music',
};

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an']);

// Custom interests ("bird watching", "food history"): every meaningful word must appear at the
// start of a word, with endings ignored, so "bird watching" matches "Bird watch in Central Park"
// and "gardening" matches "garden tour", but "art" never matches "start".
function stem(word) {
  const stripped = word.replace(/(ing|ers|es|s)$/, '');
  // Don't cut short words down to something that matches everything ("bus" -> "bu")
  return stripped.length >= 4 ? stripped : word;
}

function customPatterns(name) {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stem(w))}`, 'iu'));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const optionPatterns = Object.fromEntries(
  Object.entries(OPTION_KEYWORDS).map(([name, words]) => [name, words.map((w) => new RegExp(`\\b${w}`, 'i'))])
);

function interestMatches(interest, text, eventCategory) {
  if (!interest.isCustom && optionPatterns[interest.name]) {
    if ((CATEGORY_INTERESTS[eventCategory] || []).includes(interest.name)) return true;
    return optionPatterns[interest.name].some((re) => re.test(text));
  }
  const patterns = customPatterns(interest.name);
  return patterns.length > 0 && patterns.every((re) => re.test(text));
}

// The user's interests (rows with name/isCustom/weight) that this event relates to, strongest first
function matchInterests(event, interests) {
  const text = `${event.title} ${event.description || ''}`;
  return interests
    .filter((i) => interestMatches(i, text, event.eventCategory))
    .sort((a, b) => (b.weight || 1) - (a.weight || 1));
}

function interestPhrase(name) {
  return OPTION_PHRASES[name] || name;
}

// "gardens", "gardens and live music", "gardens, museums and live music"
function joinPhrases(names) {
  const phrases = names.map(interestPhrase);
  if (phrases.length <= 1) return phrases.join('');
  return `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
}

// Makes every reason for an interest-matched event say so, in the same words, even when the AI
// forgets the rule or writes "you like Live music" with the chip's capital letter
function personalizeReason(reason, matchedNames) {
  if (matchedNames.length === 0) return reason;
  const clause = /because you (like|enjoy|love)[^.!?]*/i;
  if (!clause.test(reason)) {
    return `We picked this for you because you like ${joinPhrases(matchedNames.slice(0, 2))}. ${reason}`;
  }
  // Only inside "because you like ...", so names like "Union Square Markets" elsewhere keep their capitals
  return reason.replace(clause, (part) =>
    Object.entries(OPTION_PHRASES).reduce((text, [name, phrase]) => text.split(name).join(phrase), part)
  );
}

module.exports = { matchInterests, interestPhrase, joinPhrases, personalizeReason };
