import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Recreates the local SQLite database from the committed migrations.
 *
 * `prisma migrate reset` is the usual tool, but it refuses to run
 * non-interactively in some environments. This does the same job for the local
 * dev database only, and - importantly - records what it applied in
 * `_prisma_migrations`, so the Prisma CLI does not later report schema drift
 * and demand a reset of its own.
 */

const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  console.error(
    `Refusing to reset a non-file database (${url.split(":")[0]}). This script is for local SQLite only.`,
  );
  process.exit(1);
}

const file = path.resolve(process.cwd(), url.replace(/^file:/, ""));
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const candidate = `${file}${suffix}`;
  if (fs.existsSync(candidate)) fs.rmSync(candidate);
}

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((d) => fs.existsSync(path.join(migrationsDir, d, "migration.sql")))
  .sort();

const db = new Database(file);

// Mirror the bookkeeping table Prisma Migrate maintains, so `migrate deploy`
// and `migrate dev` agree with us about what has already run.
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);

const record = db.prepare(
  `INSERT INTO "_prisma_migrations"
     ("id","checksum","finished_at","migration_name","started_at","applied_steps_count")
   VALUES (?,?,current_timestamp,?,current_timestamp,1)`,
);

for (const migration of migrations) {
  const sql = fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
  db.exec(sql);
  record.run(crypto.randomUUID(), crypto.createHash("sha256").update(sql).digest("hex"), migration);
}

db.close();

console.log(
  `Recreated ${path.relative(process.cwd(), file)} from ${migrations.length} migration(s).`,
);
