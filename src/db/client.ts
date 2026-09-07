import { appConfig } from "@/config/app";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Prisma 7 requires an explicit driver adapter. The adapter is chosen from the
 * shape of DATABASE_URL so that switching to Postgres is a URL change plus the
 * datasource provider line in schema.prisma - no application code moves.
 */
function createClient(): PrismaClient {
  const url = appConfig.database.url;

  if (url.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL points at PostgreSQL. Set `provider = \"postgresql\"` in " +
        "prisma/schema.prisma, install @prisma/adapter-pg, and register it here.",
    );
  }

  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!appConfig.isProduction) globalForPrisma.prisma = prisma;
