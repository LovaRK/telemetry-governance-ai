/**
 * Telemetry-Wrapped Mutations Hook
 *
 * Phase 1, Path B: Frontend Boundary Hardening
 *
 * Responsibilities:
 * 1. Generate W3C-compliant traceparent header (00-{traceId}-{spanId}-{flags})
 * 2. Fire INTENT_RECEIVED lifecycle event before mutation transport
 * 3. Attach trace context to mutation headers
 * 4. Capture trace metadata for cache coherence monitoring
 *
 * All mutations become observable causality chains from intent through verification.
 */

import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { ExecutionClass } from '@/services/trace-trust-evaluator';

/**
 * Client-side trace context
 * Mirrors server GovernanceRequestContext
 */
export interface ClientTraceContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  executionClass: ExecutionClass;
  executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
  clientInitiatedAt: number;
}

/**
 * Mutation input with governance metadata
 */
export interface GovernanceMutationPayload {
  indexName: string;
  changeSet: Record<string, any>;
  executionClass?: ExecutionClass;
  executionContext?: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
  payloadHash?: string; // Optional UI-asserted state hash
}

/**
 * Mutation result with trace attachment
 */
export interface GovernanceMutationResult {
  data: any;
  trace: ClientTraceContext;
  serverResponse?: {
    traceId: string;
    topology: string;
  };
}

/**
 * Generate deterministic W3C traceparent header
 */
function generateW3CTraceparent(
  traceId: string,
  spanId: string
): string {
  // Format: 00-{traceId:32hex}-{spanId:16hex}-{flags:2hex}
  const normalizedTraceId = traceId.padEnd(32, '0');
  const normalizedSpanId = spanId.padEnd(16, '0');
  const flags = '00'; // No special flags yet

  return `00-${normalizedTraceId}-${normalizedSpanId}-${flags}`;
}

/**
 * Generate deterministic trace IDs from current timestamp + entropy
 */
function generateTraceIds(): { traceId: string; spanId: string } {
  const timestamp = Date.now().toString(16).padStart(16, '0');
  const entropy = Math.random().toString(16).substring(2, 10);

  return {
    traceId: (timestamp + entropy).substring(0, 32),
    spanId: `spn${Date.now()}`.substring(0, 16)
  };
}

/**
 * Fire INTENT_RECEIVED lifecycle event
 * This is the first observable event for a mutation chain
 */
async function fireIntentReceived(
  trace: ClientTraceContext,
  indexName: string
): Promise<void> {
  try {
    await fetch('/api/governance/lifecycle-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        traceId: trace.traceId,
        spanId: trace.spanId,
        correlationId: trace.correlationId,
        lifecycleState: 'INTENT_RECEIVED',
        indexName,
        executionClass: trace.executionClass,
        executionContext: trace.executionContext,
        durationInStateMs: 0,
        clientInitiatedAt: trace.clientInitiatedAt
      })
    });
  } catch (err) {
    // Non-blocking: lifecycle events don't fail mutations
    console.warn('INTENT_RECEIVED event dropped:', err);
  }
}

/**
 * Primary hook for governance-aware mutations
 */
export function useTelemetryWrappedMutations(defaultOptions?: UseMutationOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    GovernanceMutationResult,
    Error,
    GovernanceMutationPayload
  >({
    mutationFn: async (input) => {
      // Step 1: Generate trace context
      const { traceId, spanId } = generateTraceIds();
      const correlationId = `corr_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;

      const trace: ClientTraceContext = {
        traceId,
        spanId,
        correlationId,
        executionClass: input.executionClass || 'DIRECT_MUTATION',
        executionContext: input.executionContext || 'PRODUCTION',
        clientInitiatedAt: Date.now()
      };

      // Step 2: Fire INTENT_RECEIVED before transport
      await fireIntentReceived(trace, input.indexName);

      // Step 3: Generate W3C traceparent header
      const traceparent = generateW3CTraceparent(trace.traceId, trace.spanId);

      // Step 4: Execute mutation with trace context headers
      const response = await fetch('/api/governance/execute-mutation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'traceparent': traceparent,
          'X-Correlation-ID': trace.correlationId,
          'X-Execution-Context': trace.executionContext,
          'X-Execution-Class': trace.executionClass
        },
        body: JSON.stringify(input.changeSet)
      });

      if (!response.ok) {
        throw new Error(`MUTATION_BOUNDARY_FAILURE_HTTP_${response.status}`);
      }

      const responseData = await response.json();

      return {
        data: responseData,
        trace,
        serverResponse: {
          traceId: response.headers.get('X-Trace-ID') || trace.traceId,
          topology: response.headers.get('X-Topology-Hash') || 'unknown'
        }
      };
    },

    onSuccess: async (result, variables) => {
      // Invalidate relevant cache entries
      // Attach trace context to invalidation for cache coherence monitoring
      await queryClient.invalidateQueries({
        queryKey: ['governance-index', variables.indexName],
        refetchType: 'all',
        meta: {
          associatedTrace: result.trace,
          invalidationInitiatedAt: Date.now()
        }
      });

      // Fire UI_RECONCILED lifecycle event
      try {
        await fetch('/api/governance/lifecycle-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            traceId: result.trace.traceId,
            correlationId: result.trace.correlationId,
            lifecycleState: 'UI_RECONCILED',
            status: 'success',
            durationInStateMs: Date.now() - result.trace.clientInitiatedAt
          })
        });
      } catch (err) {
        console.warn('UI_RECONCILED event dropped:', err);
      }
    },

    onError: async (error, variables) => {
      // Fire error lifecycle event
      try {
        await fetch('/api/governance/lifecycle-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lifecycleState: 'UI_RECONCILED',
            status: 'error',
            errorMessage: error.message,
            indexName: variables.indexName
          })
        });
      } catch (err) {
        console.warn('Error event dropped:', err);
      }
    },

    ...defaultOptions
  });

  return mutation;
}

/**
 * Hook factory for index-specific mutations
 * Pre-configures execution class and error handling for common mutation patterns
 */
export function useTelemetryMutation<T = unknown>(
  indexName: string,
  executionClass: ExecutionClass = 'DIRECT_MUTATION'
) {
  const queryClient = useQueryClient();

  return useMutation<GovernanceMutationResult, Error, Record<string, any>>({
    mutationFn: async (changeSet) => {
      const { traceId, spanId } = generateTraceIds();
      const correlationId = `corr_${Date.now()}`;

      const trace: ClientTraceContext = {
        traceId,
        spanId,
        correlationId,
        executionClass,
        executionContext: 'PRODUCTION',
        clientInitiatedAt: Date.now()
      };

      await fireIntentReceived(trace, indexName);

      const traceparent = generateW3CTraceparent(trace.traceId, trace.spanId);

      const response = await fetch(`/api/governance/indices/${indexName}/mutate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'traceparent': traceparent,
          'X-Correlation-ID': correlationId,
          'X-Execution-Class': executionClass
        },
        body: JSON.stringify(changeSet)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        data: await response.json(),
        trace,
        serverResponse: {
          traceId: response.headers.get('X-Trace-ID') || trace.traceId,
          topology: response.headers.get('X-Topology-Hash') || 'unknown'
        }
      };
    },

    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['governance-index', indexName],
        meta: { associatedTrace: result.trace }
      });
    }
  });
}
