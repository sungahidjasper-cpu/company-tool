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
 *
 * INCOMPLETE, AND KNOWINGLY SO. This list covers 26 of the schema's 41
 * models. Phase 9B added the social ones because a restore was actively
 * destroying them; the following are still absent and a restore will still
 * lose them:
 *
 *   BrandProfile, KnowledgeSource, KnowledgeSourceLink, ContentRevision,
 *   WebsiteAnalysisIssue, AiUsageLog, AiGenerationJob, PublishingConnection,
 *   PublishingCredential, PublishingJob, PublishingAttempt,
 *   ContentPublication, ContentCalendar, ContentCalendarEntry
 *
 * Adding them is not a matter of appending names: several are ordered by
 * relations this flat list cannot express (ContentPublication references both
 * a Content and a PublishingConnection; ContentRevision is self-ordering),
 * and PublishingCredential raises the same key-rotation question the social
 * credential does. That is a backup redesign, not an edit — treat this list
 * as a known operational limitation until it is done.
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
  /*
   * Phase 9B — the social models, appended so they land AFTER every parent
   * they reference (company, client, content, and each other). Restore wipes
   * in reverse of this list and recreates in order, so appending is correct
   * in both directions.
   *
   * WHY THIS MATTERED. Restore deletes `company` first, and every social row
   * cascades away with it — but nothing put them back, so a restore silently
   * destroyed a client's social accounts and the entire history of which
   * posts targeted which account. Those are not recoverable by any other
   * means, unlike a credential (reconnect) or a nonce (worthless in minutes).
   *
   * socialAccountCredential IS included: leaving it out would restore accounts
   * marked CONNECTED with no authorization behind them, which is precisely the
   * dishonest state Phase 9 removed. It holds AES-256-GCM ciphertext, never a
   * readable secret, and `backups/` is gitignored.
   *
   * socialOAuthState is deliberately EXCLUDED: it holds only in-flight
   * authorizations that expire in minutes, so a restored one is dead on
   * arrival and a restored parked authorization would be a secret kept for no
   * reason.
   */
  "socialAccount",
  "socialAccountCredential",
  "socialPost",
  "socialPostTarget",
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
