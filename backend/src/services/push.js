// Push notifications through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).
// Free and keyless; Expo forwards to Apple (APNs). Delivery to a real iPhone outside Expo Go needs
// the app built with an Apple Developer account, so until then this is best effort: in-app and email
// nudges don't depend on it.
const prisma = require('../db');

const URL = 'https://exp.host/--/api/v2/push/send';
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

function isValidPushToken(token) {
  return typeof token === 'string' && token.length <= 200 && TOKEN_PATTERN.test(token);
}

// Sends one notification to each of the user's devices. Returns how many Expo accepted.
// Tokens Expo reports as no longer registered (app deleted) are removed.
async function sendPush(userId, { title, body, data }) {
  const devices = await prisma.device.findMany({ where: { userId } });
  if (devices.length === 0) return 0;

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const res = await fetch(URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(devices.map((d) => ({ to: d.pushToken, title, body, data, sound: 'default' }))),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Expo push failed with HTTP ${res.status}`);

  const tickets = (await res.json()).data || [];
  let accepted = 0;
  for (const [i, ticket] of tickets.entries()) {
    if (ticket.status === 'ok') accepted++;
    else if (ticket.details && ticket.details.error === 'DeviceNotRegistered' && devices[i]) {
      await prisma.device.deleteMany({ where: { id: devices[i].id } });
    }
  }
  return accepted;
}

module.exports = { sendPush, isValidPushToken };
