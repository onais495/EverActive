# Data model the backend expects

The backend uses Prisma (pinned to v6). These are the models and fields the code reads and writes.
Names must match exactly; the tests use an in-memory stand-in (`tests/helpers/fakeDb.js`) with the same shape.

| SRS entity (5.3) | Model here |
|---|---|
| User | `User` |
| — (4.2) | `Session` |
| Interest | `Interest` |
| Activity | `Event` (a cached Eventbrite event) |
| ActivityStatus | `PlanItem` (an event in a user's weekly plan, with its status) |
| — (new) | `EventSource` (curated Eventbrite venue, optionally narrowed to one organizer) |

```prisma
enum Role {
  USER
  ADMIN
}

enum ActivityType {
  Solo
  Social
  Intellectual
}

enum PlanItemStatus {
  SUGGESTED
  REMOVED
  ATTENDED
}

model User {
  id            Int       @id @default(autoincrement())
  nameFirst     String    @db.VarChar(50)
  nameLast      String    @db.VarChar(50)
  dateBirth     DateTime  @db.Date
  email         String    @unique @db.VarChar(255)
  password      String    @db.VarChar(255)        // bcrypt hash
  role          Role      @default(USER)
  isActive      Boolean   @default(true)
  metroArea     String    @default("NYC") @db.VarChar(20)
  activityTypes Json?                              // e.g. ["Social","Intellectual"]; null = all three
  createdAt     DateTime  @default(now())
  sessions      Session[]
  interests     Interest[]
  planItems     PlanItem[]
}

model Session {
  id           Int      @id @default(autoincrement())
  userId       Int
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String   @unique @db.Char(64)        // SHA-256 hex
  lastActiveAt DateTime
  createdAt    DateTime @default(now())
  @@index([userId])
}

model Interest {
  id        Int      @id @default(autoincrement())
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String   @db.VarChar(40)
  isCustom  Boolean  @default(false)               // true = typed by the user
  weight    Int      @default(1)                   // for the Identity Engine later
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, name])
}

model EventSource {
  id              Int          @id @default(autoincrement())
  name            String       @db.VarChar(100)
  eventbriteVenueId     String  @db.VarChar(20)
  eventbriteOrganizerId String? @db.VarChar(20)  // null = every public event at the venue
  defaultCategory ActivityType
  metroArea       String       @default("NYC") @db.VarChar(20)
  isActive        Boolean      @default(true)
  lastSyncedAt    DateTime?
  createdAt       DateTime     @default(now())
  events          Event[]
  @@unique([eventbriteVenueId, eventbriteOrganizerId])
}

model Event {
  id           Int          @id @default(autoincrement())
  eventbriteId String       @unique @db.VarChar(20)
  sourceId     Int
  source       EventSource  @relation(fields: [sourceId], references: [id])
  title        String       @db.VarChar(200)
  description  String       @db.Text
  url          String?      @db.VarChar(500)
  startsAt     DateTime
  endsAt       DateTime?
  venueName    String?      @db.VarChar(200)
  address      String?      @db.VarChar(300)
  latitude     Float
  longitude    Float
  isFree       Boolean      @default(false)
  category     ActivityType
  metroArea    String       @db.VarChar(20)
  createdAt    DateTime     @default(now())
  planItems    PlanItem[]
  @@index([metroArea, startsAt])
}

model PlanItem {
  id        Int            @id @default(autoincrement())
  userId    Int
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  eventId   Int
  event     Event          @relation(fields: [eventId], references: [id])
  weekStart DateTime       @db.Date             // Monday of the plan's week (New York time)
  category  ActivityType
  reason    String         @db.VarChar(255)
  status    PlanItemStatus @default(SUGGESTED)
  removedAt DateTime?
  createdAt DateTime       @default(now())
  @@unique([userId, eventId, weekStart])
  @@index([userId, weekStart])
}
```

Notes:
- `password` holds a bcrypt hash (60 characters), so 5.3's `CHAR(128)` would pad it; use VARCHAR.
- `email` must be unique; login and duplicate-signup checks rely on it.
- Admin accounts are made by hand: register normally, then set `role = 'ADMIN'` in the database.
