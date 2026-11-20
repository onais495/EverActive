# Data model

The backend uses Prisma (pinned to v6). Unit tests use an in-memory stand-in (`tests/helpers/fakeDb.js`)
with the same models and fields, so the two must be kept in step.

| SRS entity (5.3) | Model here |
|---|---|
| User | `User` |
| — (4.2) | `Session` |
| Interest | `Interest` |
| Activity | `Event` (a cached Eventbrite or Luma event) |
| ActivityStatus | `PlanItem` (an event in a user's weekly plan, with its status) |
| — (new) | `EventSource` (a curated Eventbrite venue, optionally narrowed to one organizer, or a Luma calendar) |
| — (new) | `EmailCode` (hashed one-time code for email confirmation or password reset) |

The full definitions (fields, types, indexes, relations) live in [`../prisma/schema.prisma`](../prisma/schema.prisma),
which is the single source of truth. Migrations generated from it are in `../prisma/migrations/`.

## Working with the database

- **Local:** `docker compose up -d mysql` from the repo root starts MySQL on `localhost:3307`.
- **Change the schema:** edit `schema.prisma`, then from `backend/` run
  `DATABASE_URL=mysql://root:root@localhost:3307/everactive npm run db:migrate -- --name what_changed`
  (root is needed locally because Prisma creates a temporary "shadow" database to check the migration).
  Commit the new folder in `prisma/migrations/`.
- **Deploys:** the container runs `prisma migrate deploy` on start, so new migrations apply automatically.
- **Look at data locally:** `DATABASE_URL=mysql://everactive:everactive@localhost:3307/everactive npm run db:studio`

## Categories: two fields, two jobs

Every event has both:

| Field | Values | Set by | Used for |
|---|---|---|---|
| `category` | `Solo`, `Social`, `Intellectual` | the source (`EventSource.defaultCategory`) | balancing the week's mix; the activity-type preference |
| `eventCategory` | Eventbrite's category names, e.g. `Music`, `Hobbies & Special Interest` (full list in `src/constants.js`) | Eventbrite's own category on the event; for Luma (no categories in its feed), the source's `defaultEventCategory` | the app's category filter |

Luma sources are assigned a category from Eventbrite's list, so a filter like "Music" covers events from both providers.

## AI screening

Sources with `aiScreened = true` (Luma's whole-city feed) bring in many unsuitable events, so their new events
are saved with `Event.isSuitable = NULL` and screened by Gemini after each sync (`src/services/screening.js`),
which sets `isSuitable`, `category` and, if missing, `eventCategory`, plus `screenedAt`. Plans only use events with
`isSuitable = true`; everything from hand-picked sources is `true` automatically. Rejected events are kept (so they're
never re-screened) and an admin can override any decision. Re-syncs never undo a decision, and when an event is in both
a city feed and a hand-picked calendar, the calendar owns it.

## Plan item statuses

`SUGGESTED` → `NOT_INTERESTED` (user tapped "Not interested"; hidden, never suggested again, avoided in future prompts)
or → `ATTENDED` (user went; stays on the plan, future plans favor similar events, and matched interests' `weight` goes up by 1, max 5).
`respondedAt` records when. `matchedInterests` stores which of the user's interests the event was picked for.
The Sprint 3 migration renamed `REMOVED` to `NOT_INTERESTED` and `removedAt` to `respondedAt`, keeping existing rows.

Notes:
- `password` holds a bcrypt hash (60 characters), so 5.3's `CHAR(128)` would pad it; use VARCHAR.
- `email` must be unique; login and duplicate-signup checks rely on it.
- Admin accounts are made by hand: register normally, then set `role = 'ADMIN'` in the database.
