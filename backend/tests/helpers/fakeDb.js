// In-memory stand-in for the Prisma client, so tests run without MySQL.
// Supports the subset of Prisma the app uses: simple where filters (equals, in, not, gt/gte/lt/lte),
// orderBy on one field, select, include of one-to-one relations, and unique constraints.

// Per model: default column values, unique columns (or column groups), and relations for `include`
const MODELS = {
  user: {
    defaults: () => ({ role: 'USER', isActive: true, metroArea: 'NYC', activityTypes: null, createdAt: new Date() }),
    unique: [['email']],
  },
  session: {
    defaults: () => ({ createdAt: new Date() }),
    unique: [['tokenHash']],
    relations: { user: { model: 'user', foreignKey: 'userId' } },
  },
  interest: {
    defaults: () => ({ weight: 1, isCustom: false, createdAt: new Date(), updatedAt: new Date() }),
    unique: [['userId', 'name']],
  },
  eventSource: {
    defaults: () => ({
      isActive: true,
      metroArea: 'NYC',
      eventbriteOrganizerId: null,
      lastSyncedAt: null,
      createdAt: new Date(),
    }),
    unique: [['eventbriteVenueId', 'eventbriteOrganizerId']],
  },
  event: {
    defaults: () => ({ description: '', isFree: false, metroArea: 'NYC', createdAt: new Date() }),
    unique: [['eventbriteId']],
  },
  planItem: {
    defaults: () => ({ status: 'SUGGESTED', reason: '', removedAt: null, createdAt: new Date() }),
    unique: [['userId', 'eventId', 'weekStart']],
    relations: { event: { model: 'event', foreignKey: 'eventId' } },
  },
};

let tables;
let nextId;

function reset() {
  tables = Object.fromEntries(Object.keys(MODELS).map((name) => [name, []]));
  nextId = 1;
}

function same(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesCondition(value, condition) {
  const isOperatorObject = condition !== null && typeof condition === 'object' && !(condition instanceof Date);
  if (!isOperatorObject) return same(value, condition);
  return Object.entries(condition).every(([op, arg]) => {
    switch (op) {
      case 'equals': return same(value, arg);
      case 'in': return arg.some((a) => same(value, a));
      case 'not': return !same(value, arg);
      case 'gt': return value > arg;
      case 'gte': return value >= arg;
      case 'lt': return value < arg;
      case 'lte': return value <= arg;
      default: throw new Error(`fakeDb: unsupported operator ${op}`);
    }
  });
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => matchesCondition(row[key], condition));
}

function uniqueError() {
  const err = new Error('Unique constraint failed');
  err.code = 'P2002';
  return err;
}

function notFoundError() {
  const err = new Error('Record to update not found');
  err.code = 'P2025';
  return err;
}

function pick(row, select) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function shape(modelName, row, { select, include } = {}) {
  const result = pick(row, select);
  for (const [relation, option] of Object.entries(include || {})) {
    const { model, foreignKey } = MODELS[modelName].relations[relation];
    const related = tables[model].find((r) => r.id === row[foreignKey]);
    result[relation] = related ? pick(related, option === true ? null : option.select) : null;
  }
  return result;
}

function checkUnique(modelName, candidate, ignoreId) {
  for (const columns of MODELS[modelName].unique || []) {
    const clash = tables[modelName].some(
      (row) => row.id !== ignoreId && columns.every((c) => same(row[c], candidate[c]))
    );
    if (clash) throw uniqueError();
  }
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
}

function model(name) {
  const insert = (data) => {
    const row = { id: nextId++, ...MODELS[name].defaults(), ...data };
    checkUnique(name, row);
    tables[name].push(row);
    return row;
  };

  return {
    async create({ data, select, include }) {
      return shape(name, insert(data), { select, include });
    },
    async createMany({ data }) {
      data.forEach(insert);
      return { count: data.length };
    },
    async findUnique({ where, select, include }) {
      const row = tables[name].find((r) => matches(r, where));
      return row ? shape(name, row, { select, include }) : null;
    },
    async findFirst(args = {}) {
      const [row] = await this.findMany({ ...args, take: 1 });
      return row || null;
    },
    async findMany({ where, orderBy, take, select, include } = {}) {
      const rows = sortRows(tables[name].filter((r) => matches(r, where)), orderBy);
      return rows.slice(0, take ?? rows.length).map((r) => shape(name, r, { select, include }));
    },
    async count({ where } = {}) {
      return tables[name].filter((r) => matches(r, where)).length;
    },
    async update({ where, data, select, include }) {
      const row = tables[name].find((r) => matches(r, where));
      if (!row) throw notFoundError();
      checkUnique(name, { ...row, ...data }, row.id);
      Object.assign(row, data);
      return shape(name, row, { select, include });
    },
    async updateMany({ where, data }) {
      const rows = tables[name].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    async upsert({ where, create, update }) {
      const row = tables[name].find((r) => matches(r, where));
      if (row) return this.update({ where: { id: row.id }, data: update });
      return this.create({ data: create });
    },
    async deleteMany({ where } = {}) {
      const before = tables[name].length;
      tables[name] = tables[name].filter((r) => !matches(r, where));
      return { count: before - tables[name].length };
    },
  };
}

const fakeDb = {
  reset,
  // Raw rows, so tests can inspect or change state directly (e.g. age a session)
  get users() { return tables.user; },
  get sessions() { return tables.session; },
  get interests() { return tables.interest; },
  get eventSources() { return tables.eventSource; },
  get events() { return tables.event; },
  get planItems() { return tables.planItem; },

  // Array form: the operations have already run by the time they're awaited here
  async $transaction(operations) {
    return Promise.all(operations);
  },
};

for (const name of Object.keys(MODELS)) fakeDb[name] = model(name);

reset();

module.exports = fakeDb;
