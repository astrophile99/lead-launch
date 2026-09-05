import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 moved the connection URL out of schema.prisma and into this config.
// The runtime client builds its own driver adapter in src/db/client.ts; this
// file is only consumed by the Prisma CLI (migrate / studio / seed).
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
