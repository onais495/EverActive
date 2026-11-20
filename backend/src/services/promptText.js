// Text from organizers and users is untrusted, so anything going into an LLM prompt passes through
// here: strip characters that could break out of the <data> block, collapse whitespace, cap the length
function sanitizeForPrompt(text, maxLength) {
  return String(text || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

module.exports = { sanitizeForPrompt };
