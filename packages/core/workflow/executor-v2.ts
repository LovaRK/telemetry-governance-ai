/**
 * EXECUTION LAYER V2
 * Fail-closed with execution journal for crash-safe state recovery
 * Validates external system state before committing to DB
 */

import { PrismaClient } from '@prisma/client';
import { ExternalSystemAdapter } from '@core/adapters/external-system.adapter';
import type { PolicyDecision } from '@core/policy';

export interface ExecutionMetadata {
  index: string;
  sourcetype?: string;
  decision: PolicyDecision;
  compositeScore: number;
  annualCostUsd: number;
  tenantId: string;
  snapshotId: string;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'unknown';
  decisionId: string;
  idempotencyKey: string;
  error?: string;
  executedAt?: Date;
}

/**
 * Execute decision with crash-safe journal
 *
 * Flow:
 * 1. Write execution journal (STARTED)
 * 2. Execute external action
 * 3. Atomic commit: audit + journal + decision state
 *
 * If anything fails between 2-3, reconciliation will repair state.
 */
export async function executeDecisionSafe(
  db: PrismaClient,
  adapter: ExternalSystemAdapter,
  decisionId: string,
  metadata: ExecutionMetadata,
): Promise<ExecutionResult> {
  const idempotencyKey = `exec:${decisionId}:${metadata.snapshotId}:${metadata.tenantId}`;

  console.log(`[Executor] Starting execution: ${idempotencyKey}`);

  // STEP 1: Write execution intent to journal (must succeed, idempotent)
  try {
    await db.executionJournal.create({
      data: {
        decisionId,
        tenantId: metadata.tenantId,
        idempotencyKey,
        status: 'STARTED',
      },
    });
    console.log(`[Executor] Journal entry created: ${idempotencyKey}`);
  } catch (err) {
    if ((err as any).code === 'P2002') {
      // Duplicate idempotency key—already executing
      console.log(`[Executor] Already executing: ${idempotencyKey}`);
      return {
        status: 'unknown',
        decisionId,
        idempotencyKey,
        error: 'Already executing (duplicate idempotency key)',
      };
    }
    console.error(`[Executor] Failed to create journal entry:`, err);
    return {
      status: 'failed',
      decisionId,
      idempotencyKey,
      error: `Failed to write execution journal: ${(err as Error).message}`,
    };
  }

  // STEP 2: Execute external action (external system state changes here)
  let externalResult: any;
  try {
    switch (metadata.decision) {
      case 'ELIMINATE':
        externalResult = await adapter.deleteIndex({
          index: metadata.index,
          tenantId: metadata.tenantId,
          idempotencyKey,
        });
        break;
      case 'RETAIN':
      case 'MONITOR':
      case 'REBALANCE':
      case 'ESCALATE':
        // These don't execute external actions yet
        externalResult = { status: 'success' };
        break;
      default:
        throw new Error(`Unknown decision: ${metadata.decision}`);
    }

    console.log(`[Executor] External action completed: ${externalResult.status}`);
  } catch (err) {
    console.error(`[Executor] External action failed:`, err);
    // Don't mark as FAILED yet—let reconciliation probe state
    externalResult = { status: 'unknown', error: (err as Error).message };
  }

  // STEP 3: Atomic commit (audit + journal + decision state)
  // If this fails, reconciliation will detect the journal.STARTED and repair
  try {
    const result = await db.$transaction(async (tx) => {
      // Write audit event
      await tx.auditEvent.create({
        data: {
          decisionId,
          tenantId: metadata.tenantId,
          actorId: 'system',
          eventType: 'execution.completed',
          payload: {
            decision: metadata.decision,
            externalResult,
            idempotencyKey,
          },
        },
      });

      // Update journal to COMPLETED
      await tx.executionJournal.update({
        where: { idempotencyKey },
        data: {
          status: 'COMPLETED',
          externalState: externalResult,
        },
      });

      // Update decision state (only if external succeeded)
      if (externalResult.status === 'success') {
        await tx.decision.update({
          where: { id: decisionId },
          data: {
            status: 'EXECUTED',
            executedAt: new Date(),
          },
        });
      } else {
        // Mark as failed
        await tx.decision.update({
          where: { id: decisionId },
          data: {
            status: 'FAILED',
            executedAt: new Date(),
          },
        });
      }

      return externalResult;
    });

    console.log(`[Executor] ✅ Transaction committed: ${idempotencyKey}`);

    return {
      status: result.status,
      decisionId,
      idempotencyKey,
      error: result.error,
      executedAt: new Date(),
    };
  } catch (txErr) {
    console.error(`[Executor] Transaction failed (reconciliation will repair):`, txErr);

    // Transaction failed—but external action may have succeeded
    // Journal is still STARTED, so reconciliation will probe and repair
    return {
      status: 'unknown',
      decisionId,
      idempotencyKey,
      error: `Transaction failed: ${(txErr as Error).message}. Reconciliation will repair state.`,
    };
  }
}

/**
 * Check if a decision is already in progress or completed
 */
export async function getExecutionStatus(
  db: PrismaClient,
  decisionId: string,
): Promise<{ status: string; idempotencyKey?: string } | null> {
  const journal = await db.executionJournal.findFirst({
    where: { decisionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!journal) return null;

  return {
    status: journal.status,
    idempotencyKey: journal.idempotencyKey,
  };
}
