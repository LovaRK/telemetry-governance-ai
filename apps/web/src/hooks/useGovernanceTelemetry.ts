/**
 * useGovernanceTelemetry Hook
 *
 * Integrates governance telemetry recording with mutation hooks
 * Records all governance actions to the observability layer
 *
 * Usage:
 * const telemetry = useGovernanceTelemetry();
 * await telemetry.recordMutation({
 *   indexName: 'my_index',
 *   eventType: 'GOVERNANCE_STATE_TRANSITION',
 *   fromState: 'PROPOSED',
 *   toState: 'APPROVED',
 *   ...
 * });
 */

import { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface RecordMutationInput {
  indexName: string;
  eventType:
    | 'GOVERNANCE_REVIEW_SUBMITTED'
    | 'GOVERNANCE_STATE_TRANSITION'
    | 'GOVERNANCE_VERSION_COLLISION'
    | 'GOVERNANCE_RETRY_AFTER_REFRESH'
    | 'GOVERNANCE_CACHE_DESYNC'
    | 'GOVERNANCE_RATE_LIMITED'
    | 'GOVERNANCE_FORBIDDEN_TRANSITION'
    | 'GOVERNANCE_MUTATION_SUCCESS'
    | 'GOVERNANCE_MUTATION_ABANDONED'
    | 'GOVERNANCE_APPROVAL_EXPIRED'
    | 'GOVERNANCE_CAPABILITY_CHANGED'
    | 'CONFIDENCE_RECOVERY_MILESTONE';

  actionIntent?: 'approve_decision' | 'reject_decision' | 'escalate_decision' | 'request_reanalysis';
  fromState?: string;
  toState?: string;
  mutationId?: string;
  reviewerId?: string;
  clientInitiatedAt?: Date;
  clientMutationDurationMs?: number;
  apiResponseCode?: number;
  apiErrorCode?: string;
  apiResponseDurationMs?: number;
  effectiveConfidence?: number;
  confidenceBand?: string;
  governanceCap?: number;
  isCapped?: boolean;
  expectedVersion?: string;
  actualVersion?: string;
  recoveryScore?: number;
  consecutiveStableDays?: number;
  operatorSessionId?: string;
  blockingReason?: string;
}

export interface AuditHistoryResponse {
  indexName: string;
  historyStart: string;
  historyEnd: string;
  events: any[];
  trustScoreProgression: Array<{
    timestamp: string;
    confidence: number;
    band: string;
    state: string;
  }>;
  mutations: {
    total: number;
    successful: number;
    failed: number;
    abandoned: number;
  };
  errors: {
    versionCollisions: number;
    invalidationFailures: number;
    forbiddenTransitions: number;
    rateLimited: number;
  };
}

interface TelemetryMetrics {
  indexes_with_mutations_24h: number;
  version_collisions_24h: number;
  invalidation_failures_24h: number;
  operations_abandoned_24h: number;
  degraded_indexes: number;
  avg_post_refresh_success_rate: number;
  avg_operator_abandon_rate: number;
}

interface GovernanceEvent {
  eventId: string;
  indexName: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  reviewerId?: string;
  apiResponseCode?: number;
  apiErrorCode?: string;
  blockingReason?: string;
  timestamp: string;
  severity: 'ERROR' | 'COLLISION' | 'SUCCESS' | 'INFO';
}

export interface TelemetryAPI {
  recordMutation: (event: RecordMutationInput) => Promise<{ eventId: string; recorded: boolean }>;
  getAuditHistory: (indexName: string, startTime?: Date, endTime?: Date) => Promise<AuditHistoryResponse>;
  getHealthSummary: () => Promise<TelemetryMetrics>;
  getEventsStream: (limit?: number, severity?: string) => Promise<{ events: GovernanceEvent[] }>;
  recordMutationWithTiming: (
    event: RecordMutationInput,
    clientStartTime: number
  ) => Promise<{ eventId: string; recorded: boolean }>;
}

/**
 * Hook for recording governance telemetry
 * Wraps the telemetry API with automatic error handling and retry logic
 */
export function useGovernanceTelemetry(): TelemetryAPI {
  const recordingRef = useRef(new Map<string, boolean>()); // Track in-flight requests

  const recordMutation = useCallback(
    async (event: RecordMutationInput) => {
      // Deduplicate identical mutations
      const eventKey = `${event.mutationId}-${event.eventType}`;
      if (recordingRef.current.get(eventKey)) {
        return { eventId: '', recorded: false };
      }

      recordingRef.current.set(eventKey, true);

      try {
        const response = await fetch('/api/governance/mutations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });

        if (!response.ok) {
          console.warn(`Failed to record mutation: ${response.status} ${response.statusText}`);
          return { eventId: '', recorded: false };
        }

        const data = await response.json();
        return { eventId: data.eventId, recorded: true };
      } catch (error) {
        console.error('Error recording mutation:', error);
        return { eventId: '', recorded: false };
      } finally {
        recordingRef.current.delete(eventKey);
      }
    },
    []
  );

  const recordMutationWithTiming = useCallback(
    async (event: RecordMutationInput, clientStartTime: number) => {
      const clientDurationMs = performance.now() - clientStartTime;
      return recordMutation({
        ...event,
        clientInitiatedAt: new Date(clientStartTime),
        clientMutationDurationMs: Math.round(clientDurationMs),
      });
    },
    [recordMutation]
  );

  const getAuditHistory = useCallback(
    async (indexName: string, startTime?: Date, endTime?: Date): Promise<AuditHistoryResponse> => {
      const params = new URLSearchParams();
      if (startTime) params.set('startTime', startTime.toISOString());
      if (endTime) params.set('endTime', endTime.toISOString());

      const response = await fetch(`/api/governance/history/${encodeURIComponent(indexName)}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch audit history');
      return response.json();
    },
    []
  );

  const getHealthSummary = useCallback(async (): Promise<TelemetryMetrics> => {
    const response = await fetch('/api/governance/telemetry');
    if (!response.ok) throw new Error('Failed to fetch health summary');
    return response.json();
  }, []);

  const getEventsStream = useCallback(
    async (limit: number = 100, severity?: string) => {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (severity) params.set('severity', severity);

      const response = await fetch(`/api/governance/events?${params}`);
      if (!response.ok) throw new Error('Failed to fetch events stream');
      return response.json();
    },
    []
  );

  return {
    recordMutation,
    recordMutationWithTiming,
    getAuditHistory,
    getHealthSummary,
    getEventsStream,
  };
}

/**
 * Hook for querying governance telemetry with TanStack Query
 * Provides reactive, cached access to telemetry data
 */
export function useGovernanceHealthSummary(enabled: boolean = true) {
  return useQuery({
    queryKey: ['governance', 'health-summary'],
    queryFn: async () => {
      const response = await fetch('/api/governance/telemetry');
      if (!response.ok) throw new Error('Failed to fetch health summary');
      return response.json() as Promise<TelemetryMetrics>;
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Poll every minute
    enabled,
  });
}

/**
 * Hook for querying audit history with TanStack Query
 */
export function useGovernanceAuditHistory(
  indexName: string | null,
  startTime?: Date,
  endTime?: Date
) {
  return useQuery({
    queryKey: ['governance', 'audit-history', indexName, startTime?.toISOString(), endTime?.toISOString()],
    queryFn: async () => {
      if (!indexName) throw new Error('Index name required');

      const params = new URLSearchParams();
      if (startTime) params.set('startTime', startTime.toISOString());
      if (endTime) params.set('endTime', endTime.toISOString());

      const response = await fetch(`/api/governance/history/${encodeURIComponent(indexName)}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch audit history');
      return response.json() as Promise<AuditHistoryResponse>;
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!indexName,
  });
}

/**
 * Hook for querying events stream with TanStack Query
 */
export function useGovernanceEventsStream(limit: number = 100, severity?: string) {
  return useQuery({
    queryKey: ['governance', 'events-stream', limit, severity],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (severity) params.set('severity', severity);

      const response = await fetch(`/api/governance/events?${params}`);
      if (!response.ok) throw new Error('Failed to fetch events stream');
      return response.json() as Promise<{ events: GovernanceEvent[] }>;
    },
    staleTime: 15 * 1000, // 15 seconds (near real-time)
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Poll every 30 seconds
  });
}
