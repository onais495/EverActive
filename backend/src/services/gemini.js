// Minimal Gemini client (Interactions API) that returns parsed JSON matching a schema
const URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// Leaves room inside the SRS's 10-second plan generation budget
const REQUEST_TIMEOUT_MS = 8_000;

class GeminiError extends Error {}

// The REST response puts the text in output_text; fall back to the outputs list just in case
function extractText(body) {
  if (typeof body.output_text === 'string') return body.output_text;
  for (const output of body.outputs || []) {
    if (typeof output.text === 'string') return output.text;
  }
  throw new GeminiError('Gemini response had no text output.');
}

async function generateJson({ input, schema }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not set.');

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      input,
      response_format: { type: 'text', mime_type: 'application/json', schema },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new GeminiError(`Gemini request failed with HTTP ${res.status}`);

  try {
    return JSON.parse(extractText(await res.json()));
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError('Gemini returned invalid JSON.');
  }
}

module.exports = { generateJson, GeminiError };
