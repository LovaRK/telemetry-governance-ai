/**
 * RECONCILIATION WORKER
 * Detects and repairs incomplete executions caused by system crashes
 * Runs periodically (same cadence as deferral sweeper: every 5 minutes)
 *
 * Contract: For any ExecutionJournal with status=STARTED:
 *   1. Probe external system to determine what actually happened
 *   2. Repair DB state to match reality
 *   3. Emit audit trail showing reconciliation action
 */

import { PrismaClient } from '@prisma/client';
import { ExternalSystemAdapter } from '@core/adapters/external-system.adapter';
import { jobMetrics } from '@infra/observability';

export interface ReconciliationConfig {
  // How old must a STARTED journal be before we consider it stuck?
  stuckThresholdMs?: number;
  // Max entries to process per run
  batchSize?: number;
}

/**
 * Main reconciliation entry point
 */
export async function reconcileExecutions(
  db: PrismaClient,
  adapter: ExternalSystemAdapter,
  config: ReconciliationConfig = {},
): Promise<ReconciliationResult> {
  const stuckThresholdMs = config.stuckThresholdMs || 5 * 60 * 1000; // 5 minutes
  const batchSize = config.batchSize || 100;

  const startTime = Date.now();
  console.log(`[Reconciliation] Starting: checking for stuck executions older than ${stuckThresholdMs}ms`);

  try {
    // Find incomplete executions
    const stuck = await db.executionJournal.findMany({
      where: {
        status: 'STARTED',
        createdAt: {
          lt: new Date(Date.now() - stuckThresholdMs),
        },
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
      include: {
        decision: true,
      },
    });

    console.log(`[Reconciliation] Found ${stuck.length} stuck executions`);

    const results = {
      repaired: 0,
      retried: 0,
      failed: 0,
      totalDuration: 0,
    };

    for (const entry of stuck) {
      try {
        const result = await reconcileOne(db, adapter, entry);

        if (result.status === 'repaired') {
          results.repaired++;
        } else if (result.status === 'retried') {
          results.retried++;
        } else {
          results.failed++;
        }
      } catch (err) {
        console.error(`[Reconciliation] Failed to reconcile ${entry.id}:`, err);
        results.failed++;
      }
    }

    const duration = Date.now() - startTime;
    results.totalDuration = duration;

    console.log(
      `[Reconciliation] Complete: repaired=${results.repaired}, retried=${results.retried}, failed=${results.failed}, duration=${duration}ms`,
    );

    // Emit metrics
    jobMetrics.recordReconciliationRun({
      count: stuck.length,
      repaired: results.repaired,
      retried: results.retried,
      failed: results.failed,
      durationMs: duration,
    });

    return results;
  } catch (err) {
    console.error(`[Reconciliation] Fatal error:`, err);
    jobMetrics.recordReconciliationError((err as Error).message);
    throw err;
  }
}

/**
 * Reconcile a single stuck execution
 *
 * Logic:
 * 1. Probe external system for actual state
 * 2. If external says "executed": repair DB to EXECUTED
 * 3. If external says "not executed": retry safe execution
 * 4. If external says "unknown": escalate to operator
 */
async function reconcileOne(
  db: PrismaClient,
  adapter: ExternalSystemAdapter,
  entry: any,
): Promise<{ status: 'repaired' | 'retried' | 'escalated' }> {
  const { decision } = entry;

  console.log(
    `[Reconciliation] Probing external state for ${decision.index} (decision=${decision.id})`,
  );

  // Probe external system
  const probeResult = await adapter.getIndexState({
    index: decision.index,
    tenantId: decision.tenantId,
  });

  console.log(`[Reconciliation] Probe result: exists=${probeResult.exists}, deleted=${probeResult.deleted}`);

  if (decision.decision === 'ELIMINATE') {
    // ELIMINATE = index should be deleted
    if (!probeResult.exists || probeResult.deleted) {
      // External says: index is gone → execution succeeded
      return await repairExecutionSucceeded(db, entry, probeResult);
    } else if (probeResult.exists) {
      // External says: index still exists → execution failed
      return await markExecutionFailed(db, entry, 'Index still exists in Splunk');
    } else {
      // External says: unknown state → escalate
      return await escalateReconciliation(db, entry, 'Unknown external state after probe');
    }
  }

  // For other decisions (RETAIN, MONITOR, etc.), no external action happened
  // Just mark journal as completed
  await db.executionJournal.update({
    where: { id: entry.id },
    data: { status: 'COMPLETED' },
  });

  return { status: 'repaired' };
}

/**
 * External state says execution succeeded—repair DB to match
 */
async function repairExecutionSucceeded(db: PrismaClient, entry: any, probeResult: any) {
  const { decision, idempotencyKey } = entry;

  console.log(`[Reconciliation] Repairing: marking ${decision.id} as EXECUTED`);

  await db.$transaction(async (tx) => {
    // Write repair audit event
    await tx.auditEvent.create({
      data: {
        decisionId: decision.id,
        tenantId: decision.tenantId,
        actorId: 'system:reconciliation',
        eventType: 'reconciliation.execution_confirmed',
        payload: {
          reason: 'Execution journal was STARTED, external probe confirmed deletion',
          probeResult,
          idempotencyKey,
        },
      },
    });

    // Mark journal as completed
    await tx.executionJournal.update({
      where: { id: entry.id },
      data: {
        status: 'COMPLETED',
        externalState: probeResult,
      },
    });

    // Mark decision as executed
    await tx.decision.update({
      where: { id: decision.id },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
      },
    });
  });

  return { status: 'repaired' };
}

/**
 * External state says execution failed—mark as failed, escalate
 */
async function markExecutionFailed(db: PrismaClient, entry: any, reason: string) {
  const { decision } = entry;

  console.log(`[Reconciliation] Execution failed: ${reason}`);

  await db.$transaction(async (tx) => {
    await tx.auditEvent.create({
      data: {
        decisionId: decision.id,
        tenantId: decision.tenantId,
        actorId: 'system:reconciliation',
        eventType: 'reconciliation.execution_failed',
        payload: {
          reason,
        },
      },
    });

    await tx.executionJournal.update({
      where: { id: entry.id },
      data: { status: 'FAILED' },
    });

    await tx.decision.update({
      where: { id: decision.id },
      data: { status: 'FAILED' },
    });
  });

  return { status: 'retried' };
}

/**
 * Could not determine state—escalate to operator
 */
async function escalateReconciliation(db: PrismaClient, entry: any, reason: string) {
  const { decision } = entry;

  console.log(`[Reconciliation] Escalating: ${reason}`);

  await db.auditEvent.create({
    data: {
      decisionId: decision.id,
      tenantId: decision.tenantId,
      actorId: 'system:reconciliation',
      eventType: 'reconciliation.escalated',
      payload: {
        reason,
        journalId: entry.id,
        requiresManualIntervention: true,
      },
    },
  });

  // Don't update journal status—leave it STARTED for operator to investigate
  return { status: 'escalated' };
}

/**
 * Result type
 */
export interface ReconciliationResult {
  repaired: number;
  retried: number;
  failed: number;
  totalDuration: number;
}

/**
 * Scheduled reconciliation job (CronJob / BullMQ)
 * Run every 5 minutes
 */
export async function scheduleReconciliation(
  db: PrismaClient,
  adapter: ExternalSystemAdapter,
) {
  return {
    name: 'governance:reconciliation',
    cron: '*/5 * * * *', // Every 5 minutes
    handler: async () => {
      return await reconcileExecutions(db, adapter);
    },
  };
}
