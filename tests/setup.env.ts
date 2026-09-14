/**
 * Runs before any test module is imported.
 *
 * `src/db/client.ts` builds its Prisma client at module load and refuses a
 * DATABASE_URL that is not PostgreSQL. That is the right behaviour for the
 * app - Supabase Postgres is the only supported database, and failing at boot
 * beats failing on the first query - but it also means importing any service
 * throws when the variable is unset. Every test file that reaches a service,
 * even one only testing pure functions beside it, died on import.
 *
 * So the suite supplies a syntactically valid Postgres URL. `PrismaPg` builds
 * a connection pool lazily, so nothing is dialled unless a test actually runs
 * a query; the URL points at a port nothing is listening on, so a test that
 * unexpectedly did reach for the database would fail loudly rather than touch
 * a real one.
 *
 * `pipeline.integration.test.ts` overrides this with its own database.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://leadlaunch:unused@127.0.0.1:1/leadlaunch_test";
}
