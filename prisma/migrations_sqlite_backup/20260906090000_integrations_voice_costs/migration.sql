-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "OutreachMessage" ADD COLUMN "externalId" TEXT;
ALTER TABLE "OutreachMessage" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "OutreachMessage" ADD COLUMN "readAt" DATETIME;
ALTER TABLE "OutreachMessage" ADD COLUMN "templateName" TEXT;
ALTER TABLE "OutreachMessage" ADD COLUMN "variablesJson" TEXT;
ALTER TABLE "OutreachMessage" ADD COLUMN "voiceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "authUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;

-- AlterTable
ALTER TABLE "WebsiteProject" ADD COLUMN "lastCommitSha" TEXT;
ALTER TABLE "WebsiteProject" ADD COLUMN "repoBranch" TEXT DEFAULT 'main';
ALTER TABLE "WebsiteProject" ADD COLUMN "repoUrl" TEXT;
ALTER TABLE "WebsiteProject" ADD COLUMN "storagePrefix" TEXT;
ALTER TABLE "WebsiteProject" ADD COLUMN "storageProvider" TEXT;

-- CreateTable
CREATE TABLE "OutreachVoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "tone" TEXT NOT NULL,
    "length" TEXT NOT NULL,
    "salesIntensity" TEXT NOT NULL,
    "formality" TEXT NOT NULL DEFAULT 'medium',
    "personalityJson" TEXT NOT NULL,
    "customInstructions" TEXT,
    "exampleMessagesJson" TEXT,
    "analysisJson" TEXT,
    "analysedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachVoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "metaAppId" TEXT,
    "businessAccountId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhoneNumber" TEXT,
    "apiVersion" TEXT NOT NULL DEFAULT 'v21.0',
    "webhookVerifyToken" TEXT,
    "tokenConfigured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not-configured',
    "lastError" TEXT,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "bodyText" TEXT NOT NULL,
    "variablesJson" TEXT,
    "externalId" TEXT,
    "rejectedReason" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "metaAppId" TEXT,
    "igBusinessId" TEXT,
    "pageId" TEXT,
    "username" TEXT,
    "permissionsJson" TEXT,
    "tokenConfigured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not-configured',
    "lastError" TEXT,
    "lastCheckedAt" DATETIME,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstagramAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstagramConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "prospectId" TEXT,
    "externalId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantHandle" TEXT,
    "windowExpiresAt" DATETIME,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstagramConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachOptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachOptOut_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AIJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT,
    "model" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "entityType" TEXT,
    "entityId" TEXT,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "tokensCached" INTEGER,
    "costUsd" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "durationMs" INTEGER,
    "campaignId" TEXT,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "AIJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AIJob" ("attempts", "capability", "completedAt", "costUsd", "createdAt", "durationMs", "entityId", "entityType", "error", "id", "inputJson", "isMock", "model", "outputJson", "provider", "startedAt", "status", "tokensIn", "tokensOut", "type", "workspaceId") SELECT "attempts", "capability", "completedAt", "costUsd", "createdAt", "durationMs", "entityId", "entityType", "error", "id", "inputJson", "isMock", "model", "outputJson", "provider", "startedAt", "status", "tokensIn", "tokensOut", "type", "workspaceId" FROM "AIJob";
DROP TABLE "AIJob";
ALTER TABLE "new_AIJob" RENAME TO "AIJob";
CREATE INDEX "AIJob_workspaceId_status_idx" ON "AIJob"("workspaceId", "status");
CREATE INDEX "AIJob_entityType_entityId_idx" ON "AIJob"("entityType", "entityId");
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Workspace" ("createdAt", "id", "name", "slug") SELECT "createdAt", "id", "name", "slug" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OutreachVoice_workspaceId_isDefault_idx" ON "OutreachVoice"("workspaceId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachVoice_workspaceId_name_key" ON "OutreachVoice"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_workspaceId_key" ON "WhatsAppAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_accountId_name_language_key" ON "WhatsAppTemplate"("accountId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_workspaceId_key" ON "InstagramAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "InstagramConversation_prospectId_idx" ON "InstagramConversation"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramConversation_accountId_externalId_key" ON "InstagramConversation"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "OutreachOptOut_workspaceId_idx" ON "OutreachOptOut"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachOptOut_workspaceId_channel_identifier_key" ON "OutreachOptOut"("workspaceId", "channel", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
