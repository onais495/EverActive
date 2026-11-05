// Minimal Gemini client (Interactions API) that returns parsed JSON matching a schema
const URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';
// Free tier, fast, and less often overloaded than gemini-3.8-flash. Override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
// Leaves room inside the SRS's 10-second plan generation budget
const REQUEST_TIMEOUT_MS = 8_000;

class GeminiError extends Error {}

// The REST response lists steps (e.g. a hidden "thought", then "model_output");
// the answer is the text content of the model_output step(s)
function extractText(body) {
  const text = (body.steps || [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text) throw new GeminiError('Gemini response had no text output.');
  return text;
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

module.exports = { generateJson, extractText, GeminiError };
