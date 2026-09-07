-- CreateTable
CREATE TABLE "WebsiteArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text/plain',
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'inline',
    "storageKey" TEXT,
    "content" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsiteArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WebsiteVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" DATETIME,
    "fromName" TEXT,
    "replyTo" TEXT,
    "signature" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'not-connected',
    "lastError" TEXT,
    "lastCheckedAt" DATETIME,
    "connectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GmailAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "redirectTo" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ResearchRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "dataJson" TEXT,
    "pagesJson" TEXT,
    "contentHash" TEXT,
    "bytesFetched" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    CONSTRAINT "ResearchRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "cachedHits" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "estimatedUsd" REAL,
    "lastRequestAt" DATETIME,
    CONSTRAINT "ProviderUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OutreachMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sequenceStep" INTEGER NOT NULL DEFAULT 0,
    "recipient" TEXT,
    "transport" TEXT,
    "generatedByAI" BOOLEAN NOT NULL DEFAULT true,
    "editedAt" DATETIME,
    "observationsJson" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "aiJobId" TEXT,
    "voiceId" TEXT,
    "externalId" TEXT,
    "threadId" TEXT,
    "draftId" TEXT,
    "costUsd" REAL,
    "templateName" TEXT,
    "variablesJson" TEXT,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failureReason" TEXT,
    "approvedAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OutreachMessage" ("aiJobId", "approvedAt", "body", "channel", "createdAt", "deliveredAt", "externalId", "failureReason", "id", "model", "observationsJson", "prospectId", "provider", "readAt", "sentAt", "sequenceStep", "status", "subject", "templateName", "variablesJson", "variant", "voiceId") SELECT "aiJobId", "approvedAt", "body", "channel", "createdAt", "deliveredAt", "externalId", "failureReason", "id", "model", "observationsJson", "prospectId", "provider", "readAt", "sentAt", "sequenceStep", "status", "subject", "templateName", "variablesJson", "variant", "voiceId" FROM "OutreachMessage";
DROP TABLE "OutreachMessage";
ALTER TABLE "new_OutreachMessage" RENAME TO "OutreachMessage";
CREATE INDEX "OutreachMessage_prospectId_idx" ON "OutreachMessage"("prospectId");
CREATE INDEX "OutreachMessage_status_idx" ON "OutreachMessage"("status");
CREATE TABLE "new_Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "ownerId" TEXT,
    "meetingAt" DATETIME,
    "estimatedValue" INTEGER,
    "serviceType" TEXT,
    "leadSource" TEXT,
    "opportunityScore" INTEGER,
    "contactabilityScore" INTEGER,
    "websiteScore" INTEGER,
    "lastContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Prospect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Prospect" ("businessId", "campaignId", "contactabilityScore", "createdAt", "estimatedValue", "id", "lastContactAt", "leadSource", "opportunityScore", "ownerId", "priority", "serviceType", "stage", "updatedAt", "websiteScore", "workspaceId") SELECT "businessId", "campaignId", "contactabilityScore", "createdAt", "estimatedValue", "id", "lastContactAt", "leadSource", "opportunityScore", "ownerId", "priority", "serviceType", "stage", "updatedAt", "websiteScore", "workspaceId" FROM "Prospect";
DROP TABLE "Prospect";
ALTER TABLE "new_Prospect" RENAME TO "Prospect";
CREATE UNIQUE INDEX "Prospect_businessId_key" ON "Prospect"("businessId");
CREATE INDEX "Prospect_workspaceId_stage_idx" ON "Prospect"("workspaceId", "stage");
CREATE INDEX "Prospect_workspaceId_opportunityScore_idx" ON "Prospect"("workspaceId", "opportunityScore");
CREATE TABLE "new_WebsiteBuild" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "strategy" TEXT NOT NULL DEFAULT 'scaffold',
    "quality" TEXT NOT NULL DEFAULT 'balanced',
    "requestedBy" TEXT,
    "stageAtRequest" TEXT,
    "stageOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "estimateJson" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "tokensCached" INTEGER,
    "costUsd" REAL,
    "iterations" INTEGER NOT NULL DEFAULT 1,
    "qaCycles" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    "reportJson" TEXT,
    "logText" TEXT,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "WebsiteBuild_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WebsiteProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteBuild" ("completedAt", "error", "id", "iteration", "logText", "model", "projectId", "provider", "qualityScore", "reportJson", "stage", "startedAt", "status") SELECT "completedAt", "error", "id", "iteration", "logText", "model", "projectId", "provider", "qualityScore", "reportJson", "stage", "startedAt", "status" FROM "WebsiteBuild";
DROP TABLE "WebsiteBuild";
ALTER TABLE "new_WebsiteBuild" RENAME TO "WebsiteBuild";
CREATE INDEX "WebsiteBuild_projectId_idx" ON "WebsiteBuild"("projectId");
CREATE TABLE "new_WebsiteVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "buildId" TEXT,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "changesJson" TEXT,
    "filesJson" TEXT,
    "qualityScore" INTEGER,
    "reportJson" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "approval" TEXT NOT NULL DEFAULT 'draft',
    "approvedAt" DATETIME,
    "reviewNote" TEXT,
    "readmeText" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" REAL,
    "durationMs" INTEGER,
    "strategy" TEXT NOT NULL DEFAULT 'scaffold',
    "quality" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsiteVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WebsiteProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteVersion_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WebsiteBuild" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteVersion" ("buildId", "changesJson", "createdAt", "filesJson", "id", "label", "model", "projectId", "provider", "qualityScore", "reportJson", "version") SELECT "buildId", "changesJson", "createdAt", "filesJson", "id", "label", "model", "projectId", "provider", "qualityScore", "reportJson", "version" FROM "WebsiteVersion";
DROP TABLE "WebsiteVersion";
ALTER TABLE "new_WebsiteVersion" RENAME TO "WebsiteVersion";
CREATE UNIQUE INDEX "WebsiteVersion_projectId_version_key" ON "WebsiteVersion"("projectId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WebsiteArtifact_versionId_idx" ON "WebsiteArtifact"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteArtifact_versionId_path_key" ON "WebsiteArtifact"("versionId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_workspaceId_key" ON "GmailAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_state_key" ON "OAuthState"("state");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "ResearchRecord_workspaceId_fetchedAt_idx" ON "ResearchRecord"("workspaceId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRecord_businessId_source_key" ON "ResearchRecord"("businessId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_workspaceId_provider_period_key" ON "ProviderUsage"("workspaceId", "provider", "period");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

-- Sales stages were reworked: website production is no longer a pipeline stage,
-- because modelling it as one is what made an automatic build look reasonable.
-- Existing rows are mapped onto the nearest sales stage rather than dropped.
UPDATE "Prospect" SET "stage" = 'new'               WHERE "stage" = 'discovered';
UPDATE "Prospect" SET "stage" = 'researched'        WHERE "stage" IN ('audited', 'concept', 'building', 'website-ready');
UPDATE "Prospect" SET "stage" = 'contacted'         WHERE "stage" = 'follow-up';
UPDATE "Prospect" SET "stage" = 'meeting-scheduled' WHERE "stage" = 'meeting';

-- Every version that predates human review is a draft. Approval is a thing a
-- person does; back-filling it as approved would be a claim nobody made.
UPDATE "WebsiteVersion" SET "approval" = 'draft' WHERE "approval" IS NULL;
