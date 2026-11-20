// Sends email through Brevo's HTTPS API (https://developers.brevo.com/reference/sendtransacemail).
// HTTPS rather than SMTP because Railway blocks outbound SMTP below its Pro plan.
// Without BREVO_API_KEY nothing is sent, so local dev and tests never email anyone.
const URL = 'https://api.brevo.com/v3/smtp/email';
// Sign-up waits for the confirmation email, so a slow Brevo must not stall it for long
const REQUEST_TIMEOUT_MS = 5_000;

class EmailError extends Error {}

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM);
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Returns true if sent, false if email isn't configured. Throws EmailError if Brevo rejects it.
async function sendEmail({ to, subject, text }) {
  if (!isConfigured()) {
    // Never log the recipient or body: they contain an email address and a one-time code
    console.warn(`Email not sent ("${subject}"): BREVO_API_KEY or EMAIL_FROM is not set.`);
    return false;
  }

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'EverActive', email: process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      textContent: text,
      // Large, plain text for older readers; no images or tracking
      htmlContent: `<div style="font-family:Arial,sans-serif;font-size:18px;line-height:1.5">${escapeHtml(text)
        .split('\n')
        .join('<br>')}</div>`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new EmailError(`Brevo send failed with HTTP ${res.status}`);
  return true;
}

module.exports = { sendEmail, isConfigured, EmailError };
