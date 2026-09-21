-- The app chrome aggregates AIJob by workspace over a date window on every
-- navigation (the sidebar's month spend and today's job count), and the AI
-- Control Center and Settings filter it the same way. The existing indexes
-- cover status lookups and entity back-references, not this one.
--
-- A plain CREATE INDEX, not CONCURRENTLY: Prisma runs each migration inside a
-- transaction, and CONCURRENTLY cannot run in one. The brief lock is a
-- non-issue at this table's size. If AIJob is ever large enough for that lock
-- to matter, build the index by hand outside a transaction instead and let
-- this statement no-op.
CREATE INDEX IF NOT EXISTS "AIJob_workspaceId_createdAt_idx"
  ON "AIJob" ("workspaceId", "createdAt");
