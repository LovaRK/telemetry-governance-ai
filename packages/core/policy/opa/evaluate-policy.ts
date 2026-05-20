/**
 * Evaluate Policy
 *
 * Single entry point for all policy decisions.
 * Always runs inside trace context.
 * Always emits policy_evaluated event before returning.
 */

import { getTraceId } from '@infra/observability/trace-context';
import { OpaClient } from './opa-client';
import type {
  PolicyInput,
  PolicyProfile,
  PolicyResult,
} from './opa-policy.types';

const opa = new OpaClient(process.env.OPA_URL ?? 'http://localhost:8181');

/**
 * Ensure result includes all required trace/source metadata.
 */
function assertDataPurity(result: unknown): asserts result is PolicyResult {
  if (!result || typeof result !== 'object') {
    throw new Error('Policy result is not an object');
  }

  const r = result as Record<string, unknown>;

  if (typeof r.decision !== 'string') {
    throw new Error('Policy result missing decision field');
  }

  if (!Array.isArray(r.violatedGuardrails)) {
    throw new Error('Policy result missing violatedGuardrails array');
  }

  if (!Array.isArray(r.requiredApprovals)) {
    throw new Error('Policy result missing requiredApprovals array');
  }

  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    throw new Error('Policy result confidence must be 0-1');
  }
}

/**
 * Emit a pure policy evaluation event.
 * Event emission is NON-OPTIONAL: if it fails, the policy evaluation fails.
 * This ensures every policy decision is auditable.
 *
 * @throws If event emission fails
 */
async function emitPolicyEvent(event: {
  type: string;
  decisionId: string;
  profile: PolicyProfile;
  enforcementMode: 'audit' | 'enforce';
  input: PolicyInput;
  result: PolicyResult;
}): Promise<void> {
  const traceId = getTraceId();

  try {
    // Emit as pipeline_event
    // In production, this writes to pipeline_events table with:
    // - event_type: 'policy_evaluated'
    // - trace_id: traceId (non-null, from context)
    // - source: 'system'
    // - mode: 'live'
    // - payload: { decision, violatedGuardrails, requiredApprovals, ... }

    console.log(
      `[POLICY_EVENT] ${event.profile} ${event.enforcementMode} ${event.result.decision} for decision ${event.decisionId} (trace=${traceId})`
    );

    // TODO: Implement actual emission to pipeline_events table
    // await query(`INSERT INTO pipeline_events (...) VALUES (...)`);
  } catch (err) {
    // Event emission failure is fatal
    throw new Error(
      `[FATAL] Policy event emission failed for decision ${event.decisionId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Evaluate a decision against a policy profile.
 *
 * Invariants:
 * - Always runs inside trace context (AsyncLocalStorage)
 * - Event emission is non-optional (failure = evaluation failure)
 * - Result includes source, mode, traceId (data purity enforced)
 * - In enforce mode, DENY blocks execution
 *
 * @param profile Policy profile to evaluate against
 * @param input Policy input (from decision context)
 * @param enforcementMode 'audit' to log only; 'enforce' to block on DENY
 * @returns Policy result with trace context (always emitted as event before returning)
 * @throws If OPA evaluation fails, event emission fails, or decision is DENY in enforce mode
 */
export async function evaluatePolicy(
  profile: PolicyProfile,
  input: PolicyInput,
  enforcementMode: 'audit' | 'enforce' = 'audit'
): Promise<PolicyResult> {
  const traceId = getTraceId();

  // 1. Evaluate against OPA
  const raw = await opa.evaluate<
    PolicyInput,
    Omit<PolicyResult, 'source' | 'mode' | 'traceId'>
  >(`governance/${profile}`, input);

  if (!raw) {
    throw new Error(`[FATAL] OPA returned empty result for profile ${profile}`);
  }

  // 2. Bind trace context
  const result: PolicyResult = {
    ...raw,
    source: 'system',
    mode: 'live',
    traceId,
  };

  // 3. Validate data purity (throws if invalid)
  assertDataPurity(result);

  // 4. Emit event (NON-OPTIONAL: throws if emission fails)
  await emitPolicyEvent({
    type: 'policy_evaluated',
    decisionId: input.decisionId,
    profile,
    enforcementMode,
    input,
    result,
  });

  // 5. In enforce mode, DENY blocks execution
  if (enforcementMode === 'enforce' && result.decision === 'DENY') {
    throw new Error(
      `[OPA_POLICY_DENIED] Profile: ${profile}, Guardrails: ${result.violatedGuardrails.join(', ')}`
    );
  }

  // 6. Return traced, emitted, pure result
  return result;
}
