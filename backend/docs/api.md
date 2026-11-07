# EverActive API reference

For wiring the mobile app to the backend.

**Base URL:** `https://everactive-production.up.railway.app`
(put it in `mobile/src/config.ts` as `API_URL`; for a local backend use `http://<your-computer's-LAN-IP>:3000`).

## Basics

- Send and receive JSON: `Content-Type: application/json`.
- **Logged-in requests** send the token from login/register:
  `Authorization: Bearer <token>`
- **Store the token with `expo-secure-store`** (iOS Keychain), never AsyncStorage. SRS 4.2 requires it.
- **Every error** has the same shape. `message` is plain language and safe to show the user as-is:
  ```json
  { "message": "Incorrect email or password." }
  ```
  Validation errors (400) also include every problem: `{ "message": "...", "errors": ["...", "..."] }`.

| Status | Meaning | What the app should do |
|---|---|---|
| 400 | Bad input | Show `message` (or the `errors` list) |
| 401 | Not logged in, or the session expired | Delete the stored token and go to the Login screen |
| 403 | Logged in but not allowed (or account deactivated, on login) | Show `message` |
| 404 | Not found (also for items that belong to someone else) | Show `message`, refresh the plan |
| 409 | Already exists (e.g. email taken) | Show `message` |
| 429 | Too many attempts | Show `message` (it says how long to wait) |
| 500 | Server problem | "Something went wrong. Please try again." with a retry button |

**Sessions:** a token stops working after 24 hours without use, 30 days after login, or on logout. Any 401 means "log in again".

---

## Auth

### `POST /api/auth/register`
Creates the account and logs the user in (no separate login needed).

```json
{
  "nameFirst": "Gertrude",
  "nameLast": "Chen",
  "dateBirth": "1959-04-12",
  "email": "gertrude@example.com",
  "password": "retired2025"
}
```

Rules (the server checks these too, but checking in the form gives faster feedback):
- `nameFirst`, `nameLast`: required, up to 50 characters
- `dateBirth`: **`YYYY-MM-DD`**, age 18–120
- `email`: valid format; case doesn't matter (`Gertrude@X.com` = `gertrude@x.com`)
- `password`: **10–72 characters**; very common passwords are rejected. No letter/number/symbol rules.

**201** →
```json
{
  "token": "4f9c…",
  "user": { "id": 1, "nameFirst": "Gertrude", "nameLast": "Chen", "email": "gertrude@example.com", "role": "USER", "metroArea": "NYC" }
}
```
Errors: 400 (invalid input), 409 (email already registered), 429 (10 sign-ups per hour per network).
After success, go to **Interest Onboarding** (US001).

### `POST /api/auth/login`
```json
{ "email": "gertrude@example.com", "password": "retired2025" }
```
**200** → same shape as register (`token` + `user`).
Errors: 400 (missing fields), 401 (wrong email or password, same message for both), 403 (account deactivated), 429 (5 failed tries for one account in 15 minutes).

### `GET /api/auth/me` 🔒
Use on app launch: if a token is stored, call this. **200** → go to the plan; **401** → delete token, show Login.

**200** → `{ "user": { ...same fields as above } }`

### `POST /api/auth/logout` 🔒
**200** → `{ "message": "Logged out successfully." }`. Delete the stored token either way.

---

## Interests (US003) — Onboarding screen and Profile

### `GET /api/interests` 🔒
```json
{
  "options": ["Broadway", "Gardens", "Markets", "Museums", "Sports", "Book clubs", "Alumni events", "Live music"],
  "interests": ["Museums", "Markets"],
  "custom": ["food history"]
}
```
- `options`: the chips to show (same list as `INTERESTS` in `data/activities.ts`; prefer this so it stays in sync)
- `interests`: chips the user picked; `custom`: interests they typed themselves

### `PUT /api/interests` 🔒
Replaces the whole list. Used by onboarding and by editing later.
```json
{ "interests": ["Museums", "Markets"], "custom": ["food history"] }
```
- `interests` must come from `options`; at least one interest overall
- `custom`: up to 10, each 1–40 letters/numbers/spaces (basic punctuation `. , ' & -` allowed)

**200** → same shape as `GET`. Errors: 400.

---

## Preferences (US006) — activity type filter

### `GET /api/preferences` 🔒
```json
{
  "metroArea": "NYC",
  "activityTypes": ["Solo", "Social", "Intellectual"],
  "options": {
    "metroAreas": [{ "id": "NYC", "label": "New York City" }],
    "activityTypes": ["Solo", "Social", "Intellectual"]
  }
}
```

### `PUT /api/preferences` 🔒
Send only what changed:
```json
{ "activityTypes": ["Social", "Intellectual"] }
```
**200** → same shape as `GET`.

**Note:** this is the *saved* preference that decides which types go into **generated** plans. The All/Solo/Social/Intellectual chips on the Plan screen can stay as a local display filter on the items you already have.

---

## Weekly plan (US004, US005, US008)

### `GET /api/plans/current` 🔒
This week's plan. Fast (database only). Call when the Plan screen opens.
```json
{
  "weekStart": "2026-11-02",
  "items": [ ActivityCard, ... ]
}
```
`items` is empty until a plan has been generated this week → show a "Build my week" button.

### `POST /api/plans/current/generate` 🔒
Builds (or rebuilds) this week's plan. **Takes ~2–5 seconds** (AI call), so show a loading screen (`LoadingScreen.tsx`).
```json
{
  "weekStart": "2026-11-02",
  "items": [ ActivityCard, ... ],
  "source": "ai"
}
```
- `source`: `"ai"`, `"rules"` (AI was unavailable, a simpler picker chose), or `"none"` (no events match yet; then `items` is empty and `message` explains)
- Rebuilding replaces the current suggestions; removed items stay removed.
- 429 after 10 rebuilds per hour.

### `GET /api/plans/items/:id` 🔒
One activity for the **Detail screen**. **200** → `{ "item": ActivityCard }`. 404 if not found.

### `DELETE /api/plans/items/:id` 🔒
Removes an activity from the plan (one tap, US005). It won't be suggested again.
**200** → `{ "message": "Removed from your plan." }`. 404 if not found.

### `ActivityCard`
Matches the existing `Activity` type in `mobile/src/data/activities.ts`, plus a few fields:

```json
{
  "id": 12,
  "eventId": 340,
  "title": "Lectures on Tap - \"The Evolution of Mexican Food in New York City\"",
  "category": "Intellectual",
  "interests": ["Markets"],
  "day": "Tuesday",
  "time": "6:30 PM",
  "startsAt": "2026-11-10T23:30:00.000Z",
  "endsAt": "2026-11-11T01:30:00.000Z",
  "location": "Fabrik",
  "address": "123 Example St, Brooklyn, NY 11211",
  "latitude": 40.7081,
  "longitude": -73.957,
  "attendees": null,
  "description": "An evening talk on…",
  "url": "https://www.eventbrite.com/e/…",
  "isFree": false,
  "reason": "This lecture is a fun dive into food history.",
  "status": "SUGGESTED"
}
```

Differences from the current `Activity` type:
| Field | Change |
|---|---|
| `id` | **number** (was string). Use it for the item detail and remove calls. |
| `attendees` | **`null`**: Eventbrite only shares attendee counts with an event's organizer. Hide the count when null. |
| `day`, `time` | Already formatted in New York time; display as-is |
| New | `reason` (why it was picked; nice under the title), `url` (Eventbrite page, for an "Open in Eventbrite" button), `latitude`/`longitude` (map on Detail, US008), `startsAt`/`endsAt` (ISO times if you need them), `isFree` |

---

## Suggested app flow

```
Launch ─► token stored? ─no─► Login ◄──────────────── any 401
              │yes                 │
              ▼                    ▼
        GET /auth/me ─401─► Login / Register
              │200                 │ register 201
              ▼                    ▼
     GET /plans/current      Onboarding: PUT /interests
     items empty? ──yes──► "Build my week" ─► POST /plans/current/generate (Loading screen)
              │no
              ▼
        Plan screen ─tap─► Detail (GET /plans/items/:id) ─remove─► DELETE /plans/items/:id
```

## Admin endpoints (not for the app yet)
`/api/admin/event-sources` and `/api/admin/event-sync` manage which Eventbrite venues events come from. They need an `ADMIN` account and are used from the terminal for now (Admin Dashboard UI is Phase 3).
