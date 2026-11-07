# Data model

The backend uses Prisma (pinned to v6). Unit tests use an in-memory stand-in (`tests/helpers/fakeDb.js`)
with the same models and fields, so the two must be kept in step.

| SRS entity (5.3) | Model here |
|---|---|
| User | `User` |
| — (4.2) | `Session` |
| Interest | `Interest` |
| Activity | `Event` (a cached Eventbrite event) |
| ActivityStatus | `PlanItem` (an event in a user's weekly plan, with its status) |
| — (new) | `EventSource` (curated Eventbrite venue, optionally narrowed to one organizer) |

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

Notes:
- `password` holds a bcrypt hash (60 characters), so 5.3's `CHAR(128)` would pad it; use VARCHAR.
- `email` must be unique; login and duplicate-signup checks rely on it.
- Admin accounts are made by hand: register normally, then set `role = 'ADMIN'` in the database.
