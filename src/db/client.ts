import { appConfig } from "@/config/app";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 requires an explicit driver adapter.
 * PostgreSQL is the production database used by Supabase.
 */
function createClient(): PrismaClient {
  const url = appConfig.database.url;

  if (!url.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL must point to a PostgreSQL database for the Supabase setup.",
    );
  }

  const adapter = new PrismaPg({ connectionString: url });

  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ?? createClient();

if (!appConfig.isProduction) {
  globalForPrisma.prisma = prisma;
}