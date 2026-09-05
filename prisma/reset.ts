import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Recreates the local SQLite database from the committed migrations.
 *
 * `prisma migrate reset` is the usual tool, but it refuses to run
 * non-interactively in some environments; this does the same job for the local
 * dev database only. It will not touch a PostgreSQL URL.
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
for (const migration of migrations) {
  db.exec(fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8"));
}
db.close();

console.log(`Recreated ${path.relative(process.cwd(), file)} from ${migrations.length} migration(s).`);
