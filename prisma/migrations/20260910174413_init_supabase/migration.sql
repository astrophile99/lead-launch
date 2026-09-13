-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "avatarUrl" TEXT,
    "authUserId" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "provider" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "city" TEXT NOT NULL,
    "area" TEXT,
    "targetCount" INTEGER NOT NULL DEFAULT 25,
    "minRating" DOUBLE PRECISION,
    "minReviews" INTEGER,
    "websiteFilter" TEXT NOT NULL DEFAULT 'any',
    "keywords" TEXT,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "enriched" INTEGER NOT NULL DEFAULT 0,
    "audited" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "description" TEXT,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "googleUrl" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "linkedin" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "hoursJson" TEXT,
    "servicesJson" TEXT,
    "imagesJson" TEXT,
    "logoUrl" TEXT,
    "source" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "externalId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "ownerId" TEXT,
    "meetingAt" TIMESTAMP(3),
    "estimatedValue" INTEGER,
    "serviceType" TEXT,
    "leadSource" TEXT,
    "opportunityScore" INTEGER,
    "contactabilityScore" INTEGER,
    "websiteScore" INTEGER,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "engine" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "httpStatus" INTEGER,
    "https" BOOLEAN,
    "loadMs" INTEGER,
    "pageBytes" INTEGER,
    "redirected" BOOLEAN,
    "finalUrl" TEXT,
    "scorePerformance" INTEGER,
    "scoreAccessibility" INTEGER,
    "scoreBestPractices" INTEGER,
    "scoreSeo" INTEGER,
    "scoreUx" INTEGER,
    "scoreTechnical" INTEGER,
    "scoreOverall" INTEGER,
    "signalsJson" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "whatIsWrong" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "evidence" TEXT,
    "source" TEXT NOT NULL DEFAULT 'heuristic',

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "labelsJson" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "breakdownJson" TEXT NOT NULL,
    "salesAngleJson" TEXT,
    "generatedBy" TEXT NOT NULL DEFAULT 'rules',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "websiteScore" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "notesJson" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT 'next-ts-tailwind',
    "status" TEXT NOT NULL DEFAULT 'brief',
    "briefJson" TEXT,
    "repoUrl" TEXT,
    "repoBranch" TEXT DEFAULT 'main',
    "lastCommitSha" TEXT,
    "storageProvider" TEXT,
    "storagePrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteBuild" (
    "id" TEXT NOT NULL,
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
    "costUsd" DOUBLE PRECISION,
    "iterations" INTEGER NOT NULL DEFAULT 1,
    "qaCycles" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    "reportJson" TEXT,
    "logText" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteVersion" (
    "id" TEXT NOT NULL,
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
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "readmeText" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "strategy" TEXT NOT NULL DEFAULT 'scaffold',
    "quality" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteArtifact" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text/plain',
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'inline',
    "storageKey" TEXT,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'preview',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "previewUrl" TEXT,
    "productionUrl" TEXT,
    "error" TEXT,
    "logText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProviderConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "fallbackProvider" TEXT,
    "fallbackModel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
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
    "costUsd" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "durationMs" INTEGER,
    "campaignId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
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
    "editedAt" TIMESTAMP(3),
    "observationsJson" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "aiJobId" TEXT,
    "voiceId" TEXT,
    "externalId" TEXT,
    "threadId" TEXT,
    "draftId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "templateName" TEXT,
    "variablesJson" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metaJson" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectTag" (
    "prospectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProspectTag_pkey" PRIMARY KEY ("prospectId","tagId")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'prospects',
    "configJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachVoice" (
    "id" TEXT NOT NULL,
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
    "analysedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
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
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "bodyText" TEXT NOT NULL,
    "variablesJson" TEXT,
    "externalId" TEXT,
    "rejectedReason" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metaAppId" TEXT,
    "igBusinessId" TEXT,
    "pageId" TEXT,
    "username" TEXT,
    "permissionsJson" TEXT,
    "tokenConfigured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not-configured',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "prospectId" TEXT,
    "externalId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantHandle" TEXT,
    "windowExpiresAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachOptOut" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "fromName" TEXT,
    "replyTo" TEXT,
    "signature" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'not-connected',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRecord" (
    "id" TEXT NOT NULL,
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
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ResearchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "cachedHits" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "estimatedUsd" DOUBLE PRECISION,
    "lastRequestAt" TIMESTAMP(3),

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Business_workspaceId_city_idx" ON "Business"("workspaceId", "city");

-- CreateIndex
CREATE UNIQUE INDEX "Business_workspaceId_dedupeKey_key" ON "Business"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_businessId_key" ON "Prospect"("businessId");

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_stage_idx" ON "Prospect"("workspaceId", "stage");

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_opportunityScore_idx" ON "Prospect"("workspaceId", "opportunityScore");

-- CreateIndex
CREATE INDEX "WebsiteAudit_prospectId_idx" ON "WebsiteAudit"("prospectId");

-- CreateIndex
CREATE INDEX "AuditFinding_auditId_idx" ON "AuditFinding"("auditId");

-- CreateIndex
CREATE INDEX "Opportunity_prospectId_idx" ON "Opportunity"("prospectId");

-- CreateIndex
CREATE INDEX "Competitor_prospectId_idx" ON "Competitor"("prospectId");

-- CreateIndex
CREATE INDEX "WebsiteProject_prospectId_idx" ON "WebsiteProject"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteProject_workspaceId_slug_key" ON "WebsiteProject"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "WebsiteBuild_projectId_idx" ON "WebsiteBuild"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteVersion_projectId_version_key" ON "WebsiteVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "WebsiteArtifact_versionId_idx" ON "WebsiteArtifact"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteArtifact_versionId_path_key" ON "WebsiteArtifact"("versionId", "path");

-- CreateIndex
CREATE INDEX "Deployment_projectId_idx" ON "Deployment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderConfig_workspaceId_capability_key" ON "AIProviderConfig"("workspaceId", "capability");

-- CreateIndex
CREATE INDEX "AIJob_workspaceId_status_idx" ON "AIJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AIJob_entityType_entityId_idx" ON "AIJob"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "OutreachMessage_prospectId_idx" ON "OutreachMessage"("prospectId");

-- CreateIndex
CREATE INDEX "OutreachMessage_status_idx" ON "OutreachMessage"("status");

-- CreateIndex
CREATE INDEX "OutreachEvent_messageId_idx" ON "OutreachEvent"("messageId");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_at_idx" ON "Activity"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "Activity_prospectId_at_idx" ON "Activity"("prospectId", "at");

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Note_prospectId_idx" ON "Note"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_workspaceId_key_key" ON "Setting"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_workspaceId_scope_name_key" ON "SavedView"("workspaceId", "scope", "name");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_readAt_idx" ON "Notification"("workspaceId", "readAt");

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

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteProject" ADD CONSTRAINT "WebsiteProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteProject" ADD CONSTRAINT "WebsiteProject_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteBuild" ADD CONSTRAINT "WebsiteBuild_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WebsiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteVersion" ADD CONSTRAINT "WebsiteVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WebsiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteVersion" ADD CONSTRAINT "WebsiteVersion_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "WebsiteBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteArtifact" ADD CONSTRAINT "WebsiteArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WebsiteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WebsiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WebsiteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProviderConfig" ADD CONSTRAINT "AIProviderConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutreachMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectTag" ADD CONSTRAINT "ProspectTag_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectTag" ADD CONSTRAINT "ProspectTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachVoice" ADD CONSTRAINT "OutreachVoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramConversation" ADD CONSTRAINT "InstagramConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachOptOut" ADD CONSTRAINT "OutreachOptOut_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
