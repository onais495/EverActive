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
  "user": { "id": 1, "nameFirst": "Gertrude", "nameLast": "Chen", "email": "gertrude@example.com", "role": "USER", "metroArea": "NYC", "emailVerified": false }
}
```
Errors: 400 (invalid input), 409 (email already registered), 429 (10 sign-ups per hour per network).
After success, go to **Interest Onboarding** (US001). A 6-digit confirmation code is emailed at the same time; see [Email confirmation](#email-confirmation-us001).

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

### Email confirmation (US001)
Sign-up emails a **6-digit code** (valid 24 hours). Confirming is optional: an unconfirmed user can still use the app, so show a gentle banner ("Confirm your email") while `user.emailVerified` is `false`, not a blocking screen.

- `POST /api/auth/email/verify` 🔒 `{ "code": "482913" }` → **200** `{ "user": { ..., "emailVerified": true } }`. **400** if the code is wrong or expired (each code locks after 5 wrong tries).
- `POST /api/auth/email/resend` 🔒 → **200** `{ "message": "We sent a new code to your email." }`. The old code stops working. **429** after 3 per hour.

### Password reset
Two screens: "Forgot password" (email) → "Enter code + new password". Codes, not links, because the app has no website to open a link in.

- `POST /api/auth/password/forgot` `{ "email": "..." }` → **200** always, with the same message whether or not the account exists (so nobody can probe for accounts). Go to the code screen. **429** after 3 per hour for one email.
- `POST /api/auth/password/reset` `{ "email": "...", "code": "482913", "password": "new-password-here" }` → **200** `{ token, user }`, same as login: **store the new token** and go to the plan. Every other device is logged out. **400** for a wrong/expired code or a weak password (show `message`). The code is valid for 15 minutes.

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
    "activityTypes": ["Solo", "Social", "Intellectual"],
    "eventCategories": ["Music", "Community & Culture", "Charity & Causes"]
  }
}
```
`options.eventCategories`: the provider categories that upcoming events in the city actually have, most common first. **Use these for the category filter chips** on the Plan screen, so no chip ever leads to an empty list. They are Eventbrite's category names; Luma events are given one from the same list, so one chip covers both sources.

### `PUT /api/preferences` 🔒
Send only what changed:
```json
{ "activityTypes": ["Social", "Intellectual"] }
```
**200** → same shape as `GET`.

`nudgeEmails` (`true` by default): whether reminder emails are sent. Show it as a switch in Settings ("Email me reminders"); change it with `PUT /api/preferences` `{ "nudgeEmails": false }`. In-app reminders always show.

**Note:** `activityTypes` is the *saved* preference that decides which types go into **generated** plans. The category chips on the Plan screen are a local display filter on the items you already have: filter on each item's `eventCategory`.

---

## Weekly plan (US004, US005, US008, US012)

### `GET /api/plans/current` 🔒
This week's plan. Fast (database only). Call when the Plan screen opens.
```json
{
  "weekStart": "2026-11-02",
  "items": [ ActivityCard, ... ]
}
```
`items` is empty until a plan has been generated this week → show a "Build my week" button. It holds suggested and attended activities (not the ones marked "Not interested").

### `POST /api/plans/current/generate` 🔒
Builds (or rebuilds) this week's plan: **4 to 7 activities** (fewer only if fewer events exist). **Takes ~2–5 seconds** (AI call), so show a loading screen (`LoadingScreen.tsx`).
```json
{
  "weekStart": "2026-11-02",
  "items": [ ActivityCard, ... ],
  "source": "ai"
}
```
- `source`: `"ai"`, `"rules"` (AI was unavailable, a simpler picker chose), or `"none"` (no events match yet; then `items` is empty and `message` explains)
- Rebuilding replaces the current suggestions; attended items stay, and "Not interested" items never come back.
- 429 after 10 rebuilds per hour.

### `GET /api/plans/items/:id` 🔒
One activity for the **Detail screen**. **200** → `{ "item": ActivityCard }`. 404 if not found.

### `POST /api/plans/items/:id/not-interested` 🔒
**"Not interested"** (replaces "Remove", US005). One tap: the activity leaves the plan, is never suggested again (nor other dates of the same recurring event), and future plans avoid similar events.
**200** → `{ "message": "Got it. We won’t suggest this again." }`. 404 if not found.
Label the button **"Not interested"**. The old `DELETE /api/plans/items/:id` still works and does the same thing, so older builds keep working, but switch to this.

### `POST /api/plans/items/:id/attended` 🔒
**"I went"** (US012). Allowed once the event has started (`canMarkAttended` is `true`). Future plans favor similar events, and the interests it matched count for more.
**200** → `{ "message": "Thanks! We’ll suggest more like this.", "item": ActivityCard }` (status `ATTENDED`, stays on the plan).
**400** if it hasn't started yet. 404 if not found.

### `POST /api/plans/items/:id/skipped` 🔒
**"I didn't go"** (US012). Allowed once the event has started (`canMarkSkipped`). Also undoes an "I went" tapped by mistake (and clears its rating).
**200** → `{ "message": "Thanks for letting us know.", "item": ActivityCard }`. 400 if it hasn't started, 404 if not found.

### `PUT /api/plans/items/:id/rating` 🔒
**1–5 stars** for an attended activity (US012), shown after "I went" (`canRate`). Can be changed later; the new rating replaces the old one.
```json
{ "rating": 4 }
```
**200** → `{ "message": "Thanks for the rating!", "item": ActivityCard }`. 400 for anything but a whole number 1–5, or if not marked attended.
High ratings make similar activities more likely in future plans; 1–2 stars make them less likely.

### `ActivityCard`
Matches the existing `Activity` type in `mobile/src/data/activities.ts`, plus a few fields:

```json
{
  "id": 12,
  "eventId": 340,
  "title": "Lectures on Tap - \"The Evolution of Mexican Food in New York City\"",
  "category": "Intellectual",
  "eventCategory": "Community & Culture",
  "provider": "Eventbrite",
  "interests": ["Book clubs"],
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
  "reason": "We picked this for you because you like book clubs, and this talk digs into the stories behind New York's food.",
  "status": "SUGGESTED",
  "canMarkAttended": false
}
```

Differences from the current `Activity` type:
| Field | Change |
|---|---|
| `id` | **number** (was string). Use it for the item detail and remove calls. |
| `attendees` | **`null`**: Eventbrite only shares attendee counts with an event's organizer. Hide the count when null. |
| `day`, `time` | Already formatted in New York time; display as-is |
| `reason` | **The personal note**: "We picked this for you because you like …". Show it prominently on the card and the Detail screen. |
| `interests` | The user's interests this event was picked for (e.g. to highlight matching chips). Can be empty for "something different" picks. |
| `eventCategory` | **New.** The provider's category (`"Music"`, `"Hobbies & Special Interest"`, ...). Filter on this. Can be `null` for an uncategorized event (show it under "All" only). |
| `category` | Still `Solo` / `Social` / `Intellectual`, used to balance the week. Fine to show as a small tag or ignore. |
| `provider` | **New.** `"Eventbrite"` or `"Luma"`, for the button label: "Open in {provider}" with `url`. |
| `status` | `SUGGESTED`, `ATTENDED` or `SKIPPED` ("didn't go") |
| `hasStarted` | **New.** `true` once the event's start time has passed |
| `canMarkAttended` / `canMarkSkipped` | **New.** Show "I went" / "I didn't go" only when `true` (after the start time) |
| `rating`, `canRate` | **New.** The user's 1–5 stars (or `null`); show the stars when `canRate` is `true` |
| `isFree` | `true`, `false`, or **`null` = unknown** (Luma doesn't say). Show "Free" only when `true`. |
| New | `url`, `latitude`/`longitude` (map on Detail, US008), `startsAt`/`endsAt` (ISO times if you need them) |

---

## Reminders (US009)

Once a day (mid-morning New York time) the backend checks who hasn't been to a **social** activity in 7 days (new users get a week first) and writes them a personal reminder with one or two real social events coming up, preferring ones already in their plan. At most one every 3 days, and only when there's something to suggest. Each reminder is:
- **shown in the app** (below),
- **emailed** if the address is confirmed and `nudgeEmails` is on (every email has a one-tap unsubscribe link),
- **pushed** to registered phones (see Devices). Push reaches a real iPhone only in a build made with an Apple Developer account; in-app and email don't depend on it.

### `GET /api/nudges/current` 🔒
Call when the Plan screen opens. Show it as a banner above the plan; `null` means nothing to show.
```json
{
  "nudge": {
    "id": 2,
    "kind": "SOCIAL_GAP",
    "message": "It's been 9 days since your last social outing. Since you like live music, \"THE JAM VOL. XI\" on Friday at 8:00 PM could be a nice way to get out. It's already in your plan for this week.",
    "createdAt": "2026-11-20T15:00:00.000Z",
    "events": [
      { "eventId": 149, "title": "THE JAM VOL. XI", "day": "Friday", "time": "8:00 PM", "startsAt": "…", "location": "26 Bridge", "url": "https://luma.com/…", "planItemId": 23 }
    ]
  }
}
```
Tapping an event: if `planItemId` is set, open that item's Detail screen; otherwise open `url`.

### `POST /api/nudges/:id/dismiss` 🔒
The banner's ✕. **200**; the banner stays hidden.

### Devices (push notifications) 🔒
- `POST /api/devices` `{ "pushToken": "ExponentPushToken[…]", "platform": "ios" }` after the user allows notifications (from `expo-notifications`' `getExpoPushTokenAsync`). Safe to call on every launch.
- `DELETE /api/devices` `{ "pushToken": "…" }` on logout.
A push carries `data: { screen: "plan", nudgeId }`: open the Plan screen when it's tapped.

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
        Plan screen ─tap─► Detail (GET /plans/items/:id) ─"Not interested"─► POST /plans/items/:id/not-interested
                                                        ─"I went"─────────► POST /plans/items/:id/attended
```

## Admin endpoints 🔒 (ADMIN accounts only)

### `GET /api/admin/stats` — Admin Dashboard
Grouped counts only, never anything about an individual (no names, emails, IDs, or custom interest text).
`engagement` (last 4 weeks, US010): `attendanceRate` = attended ÷ (attended + didn't go) among activities users responded to; `mostAttendedActivityTypes`; `averageRatingByActivityType`; `nudgesLast7Days`.
`sourcesWithNoUpcomingEvents` names sources with nothing in the next 30 days (they probably moved or stopped; replace them). `screening` covers the AI screening of broad feeds over the next 30 days. `next7Days` counts only events that can appear in plans.
```json
{
  "generatedAt": "2026-11-20T06:19:02.846Z",
  "users": { "total": 42, "active": 41, "emailVerified": 30, "joinedLast7Days": 5 },
  "plans": {
    "weekStart": "2026-11-16",
    "usersWithPlanThisWeek": 18,
    "activitiesThisWeek": { "suggested": 70, "attended": 12, "notInterested": 9 }
  },
  "events": {
    "activeSources": 7,
    "sourcesWithNoUpcomingEvents": ["Lectures on Tap"],
    "screening": { "approved": 21, "rejected": 25, "pending": 0 },
    "next7Days": {
      "byProvider": { "EVENTBRITE": 20, "LUMA": 14 },
      "byEventCategory": { "Music": 6, "Community & Culture": 9, "Uncategorized": 1 },
      "byActivityType": { "Social": 15, "Solo": 8, "Intellectual": 11 }
    }
  },
  "interests": { "byOption": { "Broadway": 7, "Gardens": 12, "...": 0 }, "customTotal": 9 }
}
```

### Accounts (US011)
- `GET /api/admin/users?page=1` → `{ users: [{ id, nameFirst, nameLast, email, role, isActive, createdAt }], page, pageSize: 50, total }`. Names and emails only; never interests or activity.
- `PATCH /api/admin/users/:id` `{ "isActive": false }` deactivates (logs them out everywhere; nothing is deleted); `true` reactivates. Admins can't deactivate themselves.

### Reminders
`POST /api/admin/nudges/run` sends today's reminders now (for demos) → `{ summary: { checked, nudged, emailed, pushed, failed } }`.

### Event sources
Used from the terminal for now. `GET /api/admin/event-sources` lists them; `POST /api/admin/event-sync` pulls events now (the daily job does it automatically) and returns `{ results, screening }`.

`POST /api/admin/event-sources`, **Eventbrite** venue (any event ID from that venue and organizer):
```json
{ "name": "Lectures on Tap", "defaultCategory": "Intellectual", "eventId": "2003187058416" }
```
`defaultEventCategory` is optional for Eventbrite (used only if an event has no category).

**Luma** calendar: on the calendar's page, choose Subscribe → "Add iCal Subscription", copy the link, and paste it (or just the `cal-...` ID):
```json
{
  "provider": "LUMA",
  "name": "Index Greenpoint",
  "defaultCategory": "Intellectual",
  "defaultEventCategory": "Community & Culture",
  "calendar": "https://api.lu.ma/ics/get?entity=calendar&id=cal-qdFtD4iSoH7Xj4m"
}
```
`defaultEventCategory` is **required** for Luma (its feed has no categories) and must be one of Eventbrite's names (see `EVENT_CATEGORIES` in `src/constants.js`).

**Luma city feed** (AI-screened, set up automatically by a migration for NYC). A city feed has hundreds of events a month, mostly not for our users, so every new event is screened once by Gemini after each sync: suitable for our users or not, Solo/Social/Intellectual, and its category. Only approved events reach plans; unscreened ones wait for the next sync. Adding another city feed: `{ "provider": "LUMA", "name": "...", "calendar": "<the city page's iCal subscription link>" }` (no categories needed). Any source can opt in with `"aiScreened": true`.

`GET /api/admin/screened-events?verdict=rejected` (or `approved`, `pending`): the AI's decisions on upcoming events from screened sources, to spot mistakes.
`PATCH /api/admin/events/:id` `{ "isSuitable": true }` (or `false`): override the AI for one event.

`PATCH /api/admin/event-sources/:id`: any of `{ "isActive": false }`, `{ "defaultCategory": "Social" }`, `{ "defaultEventCategory": "Music" }`.
