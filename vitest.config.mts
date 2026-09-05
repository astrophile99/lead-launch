import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration test drives real service code against a temporary SQLite
    // file and runs a migration first, so give it room.
    testTimeout: 180_000,
    hookTimeout: 240_000,
    pool: "forks",
    // One worker: the integration test owns a single database file.
    maxWorkers: 1,
    fileParallelism: false,
  },
});
