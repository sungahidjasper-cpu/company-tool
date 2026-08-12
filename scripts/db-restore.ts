import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { MODEL_ORDER, M2M_INCLUDES } from "./db-backup";

const M2M_FIELDS: Partial<Record<(typeof MODEL_ORDER)[number], string[]>> = Object.fromEntries(
  Object.entries(M2M_INCLUDES).map(([model, include]) => [model, Object.keys(include as object)])
);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

type PrismaModelClient = {
  deleteMany: () => Promise<unknown>;
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};

function getClient(model: string): PrismaModelClient {
  return (prisma as unknown as Record<string, PrismaModelClient>)[model];
}

/** Backup rows are plain JSON — DateTime fields need reviving, and M2M relation arrays need converting to `connect`. */
function toCreateInput(model: (typeof MODEL_ORDER)[number], row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...row };
  const m2mFields = M2M_FIELDS[model] ?? [];

  for (const field of m2mFields) {
    const related = data[field];
    delete data[field];
    if (Array.isArray(related) && related.length > 0) {
      data[field] = { connect: related.map((r) => ({ id: (r as { id: string }).id })) };
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
      data[key] = new Date(value);
    }
  }

  // Task is the one self-referencing model (parentTaskId) — deferred to a second pass below.
  if (model === "task") data.parentTaskId = null;

  return data;
}

function findLatestBackup(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
    .sort();
  return files.length > 0 ? path.join(dir, files[files.length - 1]) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const fileArg = args.find((a) => !a.startsWith("--"));

  const backupsDir = path.join(process.cwd(), "backups");
  const filepath = fileArg ?? findLatestBackup(backupsDir);
  if (!filepath) {
    console.error(`No backup file found. Pass a path, or run "npm run db:backup" first.`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(filepath)) {
    console.error(`Backup file not found: ${filepath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Reading backup: ${filepath}`);
  const snapshot: Record<string, Record<string, unknown>[]> = JSON.parse(fs.readFileSync(filepath, "utf8"));

  if (!force) {
    console.log("\nDRY RUN — this would WIPE all current data and restore the snapshot below.");
    console.log(`Pass --force to actually restore.\n`);
    for (const model of MODEL_ORDER) console.log(`  ${model}: ${(snapshot[model] ?? []).length} rows`);
    return;
  }

  console.log("Wiping current data (reverse dependency order)...");
  for (const model of [...MODEL_ORDER].reverse()) {
    await getClient(model).deleteMany();
  }

  console.log("Restoring from snapshot...");
  for (const model of MODEL_ORDER) {
    const rows = snapshot[model] ?? [];
    for (const row of rows) {
      await getClient(model).create({ data: toCreateInput(model, row) });
    }
    console.log(`  ${model}: ${rows.length} rows restored`);
  }

  const taskRows = snapshot.task ?? [];
  const tasksWithParent = taskRows.filter((row) => row.parentTaskId);
  for (const row of tasksWithParent) {
    await getClient("task").update({
      where: { id: row.id as string },
      data: { parentTaskId: row.parentTaskId as string },
    });
  }
  if (tasksWithParent.length > 0) {
    console.log(`  task: ${tasksWithParent.length} parent-task relationships restored (second pass)`);
  }

  console.log("Restore complete.");
}

main()
  .catch((error) => {
    console.error("Restore failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
