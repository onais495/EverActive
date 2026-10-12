const { PrismaClient } = require('@prisma/client');

// One shared client for the whole app. Connection details come from DATABASE_URL.
const prisma = new PrismaClient();

module.exports = prisma;
