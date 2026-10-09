// In-memory stand-in for the Prisma client, so tests run without MySQL.
// Only implements the queries the app actually makes.
let users;
let sessions;
let nextId;

function reset() {
  users = [];
  sessions = [];
  nextId = 1;
}

function uniqueError() {
  const err = new Error('Unique constraint failed');
  err.code = 'P2002';
  return err;
}

// Mimics Prisma's `select`: only the fields set to true come back
function pick(record, select) {
  if (!select) return { ...record };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, record[k]]));
}

function matches(record, where) {
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

const fakeDb = {
  reset,
  // Lets tests reach in and change state, e.g. age a session
  get sessions() {
    return sessions;
  },
  get users() {
    return users;
  },

  user: {
    async create({ data }) {
      if (users.some((u) => u.email === data.email)) throw uniqueError();
      const user = { id: nextId++, role: 'USER', isActive: true, metroArea: null, ...data };
      users.push(user);
      return { ...user };
    },
    async findUnique({ where }) {
      const user = users.find((u) => u.email === where.email);
      return user ? { ...user } : null;
    },
  },

  session: {
    async create({ data }) {
      const session = { id: nextId++, createdAt: new Date(), ...data };
      sessions.push(session);
      return { ...session };
    },
    async findUnique({ where, include }) {
      const session = sessions.find((s) => s.tokenHash === where.tokenHash);
      if (!session) return null;
      const result = { ...session };
      if (include && include.user) {
        const user = users.find((u) => u.id === session.userId);
        result.user = pick(user, include.user.select);
      }
      return result;
    },
    async update({ where, data }) {
      const session = sessions.find((s) => s.id === where.id);
      Object.assign(session, data);
      return { ...session };
    },
    async deleteMany({ where }) {
      const before = sessions.length;
      sessions = sessions.filter((s) => !matches(s, where));
      return { count: before - sessions.length };
    },
  },
};

reset();

module.exports = fakeDb;
