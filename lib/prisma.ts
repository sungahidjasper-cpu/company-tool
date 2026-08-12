import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * max: 5 — the local `prisma dev` proxy reliably drops connections
 * (PrismaClientKnownRequestError P1017, "Server has closed the connection")
 * once this process tries to hold more than ~5-10 simultaneous physical
 * connections at once; pg's own default (10) exceeds that ceiling. Verified
 * via a controlled test: max=10 fails 100% of the time under this app's
 * normal concurrent-query load (e.g. the dashboard's ~20-query Promise.all),
 * max=5 succeeds 100% of the time. This is a local-dev-proxy limitation,
 * not a real Postgres connection-count limit (max_connections is 100) —
 * revisit if this ever runs against a real hosted Postgres instead of
 * `prisma dev`.
 */
function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL, max: 5 });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
