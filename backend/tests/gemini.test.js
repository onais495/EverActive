const { extractText } = require('../src/services/gemini');

// Shape copied from a real Interactions API response (2026-11-05)
const realResponse = {
  status: 'completed',
  steps: [
    { type: 'thought', signature: 'abc' },
    { type: 'model_output', content: [{ type: 'text', text: '{"ok": true}' }] },
  ],
};

test('reads the JSON text from the model_output step, skipping thoughts', () => {
  expect(JSON.parse(extractText(realResponse))).toEqual({ ok: true });
});

test('throws when there is no model output', () => {
  expect(() => extractText({ steps: [{ type: 'thought' }] })).toThrow('no text output');
  expect(() => extractText({})).toThrow('no text output');
});
