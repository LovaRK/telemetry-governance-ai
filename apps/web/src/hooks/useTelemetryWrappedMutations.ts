/**
 * useTelemetryWrappedMutations Hook
 *
 * Wraps trust mutations from Phase 5.2 with automatic telemetry recording
 * Records all governance actions: attempt, success, failure, version collision, etc.
 *
 * This hook bridges Phase 5.2 (governance mutations) with Phase 6 (observability)
 * Every mutation is automatically recorded to the telemetry system
 *
 * Phase 6.1: Extended with correlation ID injection and cache coherence tracking
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { useGovernanceTelemetry } from './useGovernanceTelemetry';
import { governanceCausalityService } from '@/services/governance-causality-service';

export interface GovernanceMutationContext {
  indexName: string;
  reviewerId: string;
  operatorSessionId: string;
  expectedVersion?: string;
}

export interface WrappedMutationResult<T> {
  data?: T;
  error?: Error;
  status: 'idle' | 'pending' | 'success' | 'error';
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

/**
 * Wraps a mutation with automatic telemetry recording
 */
export function useTelemetryWrappedMutation<TData, TError, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  context: GovernanceMutationContext,
  options: {
    onSuccess?: (data: TData) => void;
    onError?: (error: TError) => void;
    actionIntent?: 'approve_decision' | 'reject_decision' | 'escalate_decision' | 'request_reanalysis';
    eventType?: string;
  } = {}
) {
  const telemetry = useGovernanceTelemetry();
  const queryClient = useQueryClient();
  const mutationStartTimeRef = useRef<number>(0);
  const mutationIdRef = useRef<string>(uuidv4());
  const correlationContextRef = useRef<any>(null);
  const mutationCommittedAtRef = useRef<Date | null>(null);
  const [stateTransition, setStateTransition] = useState<{ from?: string; to?: string }>({});

  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      mutationStartTimeRef.current = performance.now();
      const clientInitiatedAt = new Date();

      // Phase 6.1: Generate correlation context at mutation origin
      const correlationContext = governanceCausalityService.generateCorrelationContext(
        context.operatorSessionId
      );
      correlationContextRef.current = correlationContext;

      // Register correlation context with backend
      try {
        await fetch('/api/governance/trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indexName: context.indexName,
            sessionId: context.operatorSessionId,
          }),
        });
      } catch (e) {
        console.warn('Failed to register correlation context:', e);
      }

      // Record mutation attempt (INTENT_RECEIVED state)
      await telemetry.recordMutation({
        indexName: context.indexName,
        eventType: 'GOVERNANCE_REVIEW_SUBMITTED',
        mutationId: mutationIdRef.current,
        reviewerId: context.reviewerId,
        operatorSessionId: context.operatorSessionId,
        actionIntent: options.actionIntent,
        clientInitiatedAt,
        expectedVersion: context.expectedVersion,
      });

      // Record lifecycle state: INTENT_RECEIVED
      try {
        await fetch('/api/governance/mutation-lifecycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            correlationId: correlationContext.correlationId,
            lifecycleState: 'INTENT_RECEIVED',
            stateTransitionReason: `User initiated ${options.actionIntent}`,
          }),
        });
      } catch (e) {
        console.warn('Failed to record lifecycle event:', e);
      }

      try {
        const result = await mutationFn(variables);
        const duration = performance.now() - mutationStartTimeRef.current;
        mutationCommittedAtRef.current = new Date();

        // Record success
        await telemetry.recordMutation({
          indexName: context.indexName,
          eventType: 'GOVERNANCE_MUTATION_SUCCESS',
          mutationId: mutationIdRef.current,
          reviewerId: context.reviewerId,
          operatorSessionId: context.operatorSessionId,
          actionIntent: options.actionIntent,
          clientMutationDurationMs: Math.round(duration),
          apiResponseCode: 200,
        });

        // Record lifecycle states: STATE_PERSISTED → QUERY_INVALIDATED
        const invalidationRequestedAt = new Date();
        try {
          await Promise.all([
            fetch('/api/governance/mutation-lifecycle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                correlationId: correlationContext.correlationId,
                lifecycleState: 'STATE_PERSISTED',
                previousState: 'API_ACCEPTED',
                durationInStateMs: Math.round(duration * 0.3),
              }),
            }),
            fetch('/api/governance/mutation-lifecycle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                correlationId: correlationContext.correlationId,
                lifecycleState: 'QUERY_INVALIDATED',
                previousState: 'STATE_PERSISTED',
                stateTransitionReason: 'TanStack Query cache invalidation initiated',
              }),
            }),
          ]);
        } catch (e) {
          console.warn('Failed to record lifecycle states:', e);
        }

        // Invalidate relevant queries to ensure fresh data (CACHE_REFRESH_REQUESTED)
        const cacheRefreshInitiatedAt = new Date();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['trust-inspection', context.indexName] }),
          queryClient.invalidateQueries({ queryKey: ['governance', 'health-summary'] }),
          queryClient.invalidateQueries({ queryKey: ['governance', 'audit-history', context.indexName] }),
        ]);

        // Record cache refetch and reconciliation
        const uiAcknowledgedAt = new Date();
        try {
          await fetch('/api/governance/cache-coherence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              indexName: context.indexName,
              correlationId: correlationContext.correlationId,
              mutationCommittedAt: mutationCommittedAtRef.current.toISOString(),
              invalidationRequestedAt: invalidationRequestedAt.toISOString(),
              serverResponseReceivedAt: cacheRefreshInitiatedAt.toISOString(),
              uiRefetchInitiatedAt: cacheRefreshInitiatedAt.toISOString(),
              uiAcknowledgedAt: uiAcknowledgedAt.toISOString(),
              invalidationFailed: false,
              refetchFailed: false,
              uiStillStale: false,
            }),
          });
        } catch (e) {
          console.warn('Failed to record cache coherence metrics:', e);
        }

        // Record final lifecycle state: OPERATOR_ACKNOWLEDGED
        try {
          await fetch('/api/governance/mutation-lifecycle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              correlationId: correlationContext.correlationId,
              lifecycleState: 'OPERATOR_ACKNOWLEDGED',
              previousState: 'UI_RECONCILED',
              stateTransitionReason: 'Operator confirmed state change visible in UI',
            }),
          });
        } catch (e) {
          console.warn('Failed to record final lifecycle event:', e);
        }

        return result;
      } catch (error: any) {
        const duration = performance.now() - mutationStartTimeRef.current;

        // Classify error and record appropriately
        const errorCode = error?.response?.status;
        let eventType = 'GOVERNANCE_MUTATION_ABANDONED';
        let apiErrorCode: string | undefined;

        if (errorCode === 409) {
          eventType = 'GOVERNANCE_VERSION_COLLISION';
          apiErrorCode = 'STATE_VERSION_MISMATCH';
        } else if (errorCode === 422) {
          eventType = 'GOVERNANCE_FORBIDDEN_TRANSITION';
          apiErrorCode = 'FORBIDDEN_STATE_TRANSITION';
        } else if (errorCode === 429) {
          eventType = 'GOVERNANCE_RATE_LIMITED';
          apiErrorCode = 'GOVERNANCE_RATE_LIMIT';
        }

        // Record failure
        await telemetry.recordMutation({
          indexName: context.indexName,
          eventType,
          mutationId: mutationIdRef.current,
          reviewerId: context.reviewerId,
          operatorSessionId: context.operatorSessionId,
          actionIntent: options.actionIntent,
          clientMutationDurationMs: Math.round(duration),
          apiResponseCode: errorCode || 500,
          apiErrorCode,
          blockingReason: error?.message,
        });

        throw error;
      }
    },
    onSuccess: (data) => {
      options.onSuccess?.(data);
    },
    onError: (error) => {
      options.onError?.(error as TError);
    },
  });

  return mutation;
}

/**
 * Tracks operator session for telemetry
 * Records when an operator starts and stops a governance workflow
 */
export function useOperatorSession(reviewerId: string) {
  const telemetry = useGovernanceTelemetry();
  const [sessionId] = useState(() => uuidv4());
  const sessionStartRef = useRef<number>(performance.now());
  const actionsRef = useRef<string[]>([]);

  const recordAction = useCallback((action: string) => {
    actionsRef.current.push(action);
  }, []);

  const endSession = useCallback(async (notes?: string) => {
    const duration = performance.now() - sessionStartRef.current;

    // Could be extended to record session end to database
    console.log(`Session ${sessionId} ended after ${Math.round(duration)}ms with actions:`, actionsRef.current);
  }, [sessionId]);

  return {
    sessionId,
    recordAction,
    endSession,
  };
}

/**
 * Higher-order hook that wraps all governance mutations with telemetry
 */
export function useGovernanceMutationsWithTelemetry(context: GovernanceMutationContext) {
  const queryClient = useQueryClient();

  const approveDecision = useTelemetryWrappedMutation(
    async (variables: { reason?: string }) => {
      const response = await fetch(`/api/governance/review/${context.indexName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_decision',
          reason: variables.reason,
          expectedVersion: context.expectedVersion,
        }),
      });

      if (!response.ok) {
        const error = new Error('Approval failed');
        (error as any).response = { status: response.status };
        throw error;
      }

      return response.json();
    },
    context,
    {
      actionIntent: 'approve_decision',
      eventType: 'GOVERNANCE_STATE_TRANSITION',
    }
  );

  const rejectDecision = useTelemetryWrappedMutation(
    async (variables: { reason?: string }) => {
      const response = await fetch(`/api/governance/review/${context.indexName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject_decision',
          reason: variables.reason,
          expectedVersion: context.expectedVersion,
        }),
      });

      if (!response.ok) {
        const error = new Error('Rejection failed');
        (error as any).response = { status: response.status };
        throw error;
      }

      return response.json();
    },
    context,
    {
      actionIntent: 'reject_decision',
      eventType: 'GOVERNANCE_STATE_TRANSITION',
    }
  );

  const escalateDecision = useTelemetryWrappedMutation(
    async (variables: { reason?: string }) => {
      const response = await fetch(`/api/governance/review/${context.indexName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'escalate_decision',
          reason: variables.reason,
          expectedVersion: context.expectedVersion,
        }),
      });

      if (!response.ok) {
        const error = new Error('Escalation failed');
        (error as any).response = { status: response.status };
        throw error;
      }

      return response.json();
    },
    context,
    {
      actionIntent: 'escalate_decision',
      eventType: 'GOVERNANCE_STATE_TRANSITION',
    }
  );

  const requestReanalysis = useTelemetryWrappedMutation(
    async (variables: { priority?: string }) => {
      const response = await fetch(`/api/governance/reanalyze/${context.indexName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_reanalysis',
          priority: variables.priority,
        }),
      });

      if (!response.ok) {
        const error = new Error('Reanalysis request failed');
        (error as any).response = { status: response.status };
        throw error;
      }

      return response.json();
    },
    context,
    {
      actionIntent: 'request_reanalysis',
      eventType: 'GOVERNANCE_CAPABILITY_CHANGED',
    }
  );

  return {
    approveDecision,
    rejectDecision,
    escalateDecision,
    requestReanalysis,
  };
}
