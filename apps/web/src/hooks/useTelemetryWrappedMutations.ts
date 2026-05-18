/**
 * useTelemetryWrappedMutations Hook
 *
 * Wraps trust mutations from Phase 5.2 with automatic telemetry recording
 * Records all governance actions: attempt, success, failure, version collision, etc.
 *
 * This hook bridges Phase 5.2 (governance mutations) with Phase 6 (observability)
 * Every mutation is automatically recorded to the telemetry system
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { useGovernanceTelemetry } from './useGovernanceTelemetry';

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
  const [stateTransition, setStateTransition] = useState<{ from?: string; to?: string }>({});

  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      mutationStartTimeRef.current = performance.now();

      // Record mutation attempt
      await telemetry.recordMutation({
        indexName: context.indexName,
        eventType: 'GOVERNANCE_REVIEW_SUBMITTED',
        mutationId: mutationIdRef.current,
        reviewerId: context.reviewerId,
        operatorSessionId: context.operatorSessionId,
        actionIntent: options.actionIntent,
        clientInitiatedAt: new Date(),
        expectedVersion: context.expectedVersion,
      });

      try {
        const result = await mutationFn(variables);
        const duration = performance.now() - mutationStartTimeRef.current;

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

        // Invalidate relevant queries to ensure fresh data
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['trust-inspection', context.indexName] }),
          queryClient.invalidateQueries({ queryKey: ['governance', 'health-summary'] }),
          queryClient.invalidateQueries({ queryKey: ['governance', 'audit-history', context.indexName] }),
        ]);

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
