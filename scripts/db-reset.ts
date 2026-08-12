import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * The one sanctioned destructive-reset path — backs up first, unconditionally,
 * before touching anything. Raw `prisma migrate reset` / `prisma dev rm`
 * should never be run directly; this script (and its CONFIRM gate) exists
 * specifically because running one of those directly, without a backup,
 * is what caused real data loss once already in this project.
 */
function main() {
  if (process.env.CONFIRM !== "yes") {
    console.log("This will WIPE the local dev database and reseed it from scratch.");
    console.log('Re-run as: CONFIRM=yes npm run db:reset');
    process.exitCode = 1;
    return;
  }

  console.log("Backing up before reset...");
  execSync("npx tsx scripts/db-backup.ts", { stdio: "inherit" });

  console.log("\nResetting database...");
  execSync("npx prisma migrate reset --force --skip-seed", { stdio: "inherit" });

  console.log("\nReseeding...");
  execSync("npm run db:seed", { stdio: "inherit" });

  console.log("\nReset complete.");
}

main();
