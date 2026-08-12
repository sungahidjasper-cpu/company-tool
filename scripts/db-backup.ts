import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";

/**
 * Dependency order matters for restore (parents before children) — this
 * list doubles as that order. `pg_dump` isn't installed on this machine
 * (confirmed before choosing this approach), so backups are plain JSON
 * snapshots taken through Prisma Client instead. This is a local dev
 * safety net, not a production DR strategy — see
 * docs/development/database.md for what to use in production.
 */
export const MODEL_ORDER = [
  "company",
  "permission",
  "tag",
  "role",
  "user",
  "client",
  "contact",
  "project",
  "lead",
  "leadTask",
  "task",
  "sEOProject",
  "keywordCluster",
  "keyword",
  "content",
  "note",
  "activity",
  "file",
  "notification",
  "aIConversation",
  "report",
  "websiteAnalysisJob",
] as const;

/** Implicit many-to-many relations — captured as related IDs so restore can `connect` them back. */
export const M2M_INCLUDES: Partial<Record<(typeof MODEL_ORDER)[number], object>> = {
  role: { permissions: { select: { id: true } } },
  user: { roles: { select: { id: true } } },
  client: { tags: { select: { id: true } } },
  project: { assignedUsers: { select: { id: true } }, tags: { select: { id: true } } },
  task: { tags: { select: { id: true } } },
  sEOProject: { tags: { select: { id: true } } },
  content: { tags: { select: { id: true } }, keywords: { select: { id: true } } },
};

type PrismaModelClient = { findMany: (args?: { include?: object }) => Promise<unknown[]> };

export async function backupDatabase(): Promise<string> {
  const snapshot: Record<string, unknown[]> = {};

  for (const model of MODEL_ORDER) {
    const client = (prisma as unknown as Record<string, PrismaModelClient>)[model];
    const include = M2M_INCLUDES[model];
    const rows = await client.findMany(include ? { include } : undefined);
    snapshot[model] = rows;
    console.log(`  ${model}: ${rows.length} rows`);
  }

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

  return filepath;
}

async function main() {
  console.log("Backing up database...");
  const filepath = await backupDatabase();
  console.log(`Backup written to ${filepath}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Backup failed:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
