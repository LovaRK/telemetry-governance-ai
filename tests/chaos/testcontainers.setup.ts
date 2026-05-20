/**
 * TESTCONTAINERS SETUP
 * Provides ephemeral Postgres, Redis, and WireMock containers for chaos testing
 * All containers cleaned up after tests complete
 */

import { PostgreSqlContainer, StartedPostgresContainer, GenericContainer, StartedGenericContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import fetch from 'node-fetch';

export interface TestEnvironment {
  postgres: StartedPostgresContainer;
  redis: StartedGenericContainer;
  wiremock: StartedGenericContainer;
  db: PrismaClient;
  redisClient: Redis;
  cleanup: () => Promise<void>;
}

/**
 * Start all containers and return configured clients
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  console.log('[TestContainers] Starting Postgres...');
  const postgres = await new PostgreSqlContainer().start();

  console.log('[TestContainers] Starting Redis...');
  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  console.log('[TestContainers] Starting WireMock...');
  const wiremock = await new GenericContainer('wiremock/wiremock:latest')
    .withExposedPorts(8080)
    .withCommand(['--global-response-templating', '--verbose'])
    .start();

  const postgresUri = postgres.getConnectionUri();
  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);
  const wiremockUrl = `http://${wiremock.getHost()}:${wiremock.getMappedPort(8080)}`;

  console.log(`[TestContainers] Postgres: ${postgresUri}`);
  console.log(`[TestContainers] Redis: ${redisHost}:${redisPort}`);
  console.log(`[TestContainers] WireMock: ${wiremockUrl}`);

  // Create Prisma client
  const db = new PrismaClient({
    datasourceUrl: postgresUri,
  });

  // Run migrations
  console.log('[TestContainers] Running migrations...');
  await db.$executeRawUnsafe(`
    -- Create decisions table
    CREATE TABLE IF NOT EXISTS "decisions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenantId" TEXT NOT NULL,
      "snapshotId" TEXT NOT NULL,
      "index" TEXT NOT NULL,
      "decision" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
      "compositeScore" DOUBLE PRECISION NOT NULL,
      "annualCostUsd" DOUBLE PRECISION NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP NOT NULL,
      "executedAt" TIMESTAMP,
      "approvedAt" TIMESTAMP,
      "rejectedAt" TIMESTAMP,
      "deferredAt" TIMESTAMP,
      "deferredUntil" TIMESTAMP,
      "deferredReason" TEXT,
      "reawokenAt" TIMESTAMP,
      "reawokenCount" INTEGER NOT NULL DEFAULT 0,
      "approverAccountId" TEXT,
      "rejectionReason" TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "decisions_tenantId_snapshotId_index_key"
      ON "decisions"("tenantId", "snapshotId", "index");
    CREATE INDEX IF NOT EXISTS "decisions_status_idx" ON "decisions"("status");
    CREATE INDEX IF NOT EXISTS "decisions_tenantId_status_idx" ON "decisions"("tenantId", "status");

    -- Create execution_journal table
    CREATE TABLE IF NOT EXISTS "execution_journal" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "decisionId" TEXT NOT NULL REFERENCES "decisions"("id") ON DELETE CASCADE,
      "tenantId" TEXT NOT NULL,
      "idempotencyKey" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'STARTED',
      "externalState" JSONB,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS "execution_journal_status_idx" ON "execution_journal"("status");
    CREATE INDEX IF NOT EXISTS "execution_journal_decisionId_idx" ON "execution_journal"("decisionId");
    CREATE INDEX IF NOT EXISTS "execution_journal_tenant_status_idx" ON "execution_journal"("tenantId", "status");
    CREATE INDEX IF NOT EXISTS "execution_journal_incomplete_idx" ON "execution_journal"("status") WHERE "status" = 'STARTED';

    -- Create audit_events table
    CREATE TABLE IF NOT EXISTS "audit_events" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "decisionId" TEXT NOT NULL REFERENCES "decisions"("id") ON DELETE CASCADE,
      "tenantId" TEXT NOT NULL,
      "actorId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS "audit_events_decisionId_idx" ON "audit_events"("decisionId");
    CREATE INDEX IF NOT EXISTS "audit_events_tenantId_createdAt_idx" ON "audit_events"("tenantId", "createdAt");
  `);

  // Create Redis client
  const redisClient = new Redis({
    host: redisHost,
    port: redisPort,
  });

  // Test connections
  console.log('[TestContainers] Testing Postgres connection...');
  await db.$queryRaw`SELECT 1`;

  console.log('[TestContainers] Testing Redis connection...');
  await redisClient.ping();

  console.log('[TestContainers] Testing WireMock connection...');
  const health = await fetch(`${wiremockUrl}/__admin/`);
  if (!health.ok) throw new Error('WireMock failed to start');

  console.log('[TestContainers] ✅ All containers ready');

  return {
    postgres,
    redis,
    wiremock,
    db,
    redisClient,
    cleanup: async () => {
      console.log('[TestContainers] Cleaning up...');
      await db.$disconnect();
      await redisClient.disconnect();
      await postgres.stop();
      await redis.stop();
      await wiremock.stop();
      console.log('[TestContainers] ✅ Cleaned up');
    },
  };
}

/**
 * Helper: Create a test decision
 */
export async function createTestDecision(
  db: PrismaClient,
  tenantId: string = 'test-tenant',
  index: string = 'test-index',
  decision: string = 'ELIMINATE',
) {
  const id = `decision-${Date.now()}`;
  return await db.decision.create({
    data: {
      id,
      tenantId,
      snapshotId: `snapshot-${Date.now()}`,
      index,
      decision,
      status: 'APPROVED',
      compositeScore: 15,
      annualCostUsd: 5000,
    },
  });
}

/**
 * Helper: Configure WireMock stub
 */
export async function configureWireMockStub(
  wiremockUrl: string,
  stub: {
    method: string;
    urlPathPattern: string;
    status: number;
    fixedDelayMilliseconds?: number;
    responseBody?: Record<string, any>;
    malformedResponseChunking?: boolean;
  },
) {
  const response = await fetch(`${wiremockUrl}/__admin/mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: {
        method: stub.method,
        urlPathPattern: stub.urlPathPattern,
      },
      response: {
        status: stub.status,
        fixedDelayMilliseconds: stub.fixedDelayMilliseconds,
        body: stub.responseBody ? JSON.stringify(stub.responseBody) : undefined,
        ...(stub.malformedResponseChunking && {
          transformers: ['response-template'],
          transformerParameters: {
            malformedResponseChunking: true,
          },
        }),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to configure WireMock: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Helper: Reset WireMock state
 */
export async function resetWireMock(wiremockUrl: string) {
  await fetch(`${wiremockUrl}/__admin/reset`, { method: 'POST' });
}
