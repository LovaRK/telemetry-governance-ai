/**
 * Cache Coherence Monitor Hook
 *
 * Phase 1: Cache Domain Health Tracking
 *
 * Subscribes to TanStack Query cache update stream.
 * Measures cache invalidation latency and state hash verification.
 * Emits coherence telemetry for trace trust evaluation.
 *
 * Key Metrics:
 * - invalidationLatencyMs: Time from invalidation trigger to cache update
 * - staleRenderDurationMs: Time UI renders stale data after invalidation
 * - coherenceTier: NOMINAL | DEGRADED | STALE | SEVERE
 * - targetStateHash vs actualStateHash: Verification against server state
 */

import { useEffect, useCallback } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';

/**
 * Coherence tier classification
 */
export type CoherenceTier = 'NOMINAL' | 'DEGRADED' | 'STALE' | 'SEVERE';

/**
 * Cache coherence telemetry event
 */
export interface CacheCoherenceTelemetry {
  traceId: string;
  correlationId: string;
  indexName: string;
  invalidationLatencyMs: number;
  staleRenderDurationMs: number;
  coherenceTier: CoherenceTier;
  targetStateHash: string;
  actualStateHash: string;
  recordedAt: number;
}

/**
 * Classify coherence tier based on latency
 */
function classifyCoherenceTier(latencyMs: number): CoherenceTier {
  if (latencyMs < 500) return 'NOMINAL';
  if (latencyMs < 3000) return 'DEGRADED';
  if (latencyMs < 10000) return 'STALE';
  return 'SEVERE';
}

/**
 * Send telemetry to backend
 * Non-blocking: failures don't affect UI
 */
async function emitCoherenceTelemetry(
  telemetry: CacheCoherenceTelemetry
): Promise<void> {
  try {
    await fetch('/api/governance/telemetry/coherence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetry),
      // Don't wait for response
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    // Silently fail: coherence monitoring is observational only
    console.debug('Coherence telemetry dropped:', err instanceof Error ? err.message : err);
  }
}

/**
 * Main cache coherence monitoring hook
 *
 * Attaches to global TanStack Query cache lifecycle.
 * Tracks all mutations and invalidations for the given index.
 *
 * @param indexName - The governance index being monitored (e.g., 'governance_settings')
 * @param targetStateHash - Optional server-provided hash for verification
 */
export function useCacheCoherenceMonitor(
  indexName: string,
  targetStateHash?: string
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cacheInstance = queryClient.getQueryCache();

    // Subscribe to all cache updates
    const unsubscribe = cacheInstance.subscribe((event) => {
      // Only process mutations and cache updates
      if (event.type !== 'updated' || !event.action.data) {
        return;
      }

      // Extract trace context from mutation metadata
      const metadata = (event.query.meta || {}) as Record<string, any>;
      const trace = metadata.associatedTrace;

      // Only emit for relevant execution classes
      if (!trace || !['DIRECT_MUTATION', 'CACHE_INVALIDATING'].includes(trace.executionClass)) {
        return;
      }

      // Calculate invalidation latency
      const invalidationInitiatedAt = metadata.invalidationInitiatedAt || Date.now();
      const uiSettledAt = Date.now();
      const invalidationLatencyMs = uiSettledAt - invalidationInitiatedAt;

      // Determine stale render duration (buffer if latency is high)
      const staleRenderDurationMs = Math.max(0, invalidationLatencyMs - 500);

      // Classify coherence tier
      const coherenceTier = classifyCoherenceTier(invalidationLatencyMs);

      // Extract state hashes from response
      const serverHash = targetStateHash || event.action.data?.stateHash || 'UNKNOWN';
      const clientHash = event.action.data?.clientStateHash || 'UNVERIFIED';

      // Construct telemetry record
      const telemetry: CacheCoherenceTelemetry = {
        traceId: trace.traceId,
        correlationId: trace.correlationId,
        indexName,
        invalidationLatencyMs,
        staleRenderDurationMs,
        coherenceTier,
        targetStateHash: serverHash,
        actualStateHash: clientHash,
        recordedAt: Date.now()
      };

      // Emit asynchronously (don't block UI)
      emitCoherenceTelemetry(telemetry);
    });

    return () => unsubscribe();
  }, [indexName, queryClient, targetStateHash]);
}

/**
 * Hook to retrieve real-time coherence metrics
 * Returns recent coherence history for a given index
 */
export function useCacheCoherenceMetrics(indexName: string, windowMs: number = 60000) {
  return useQuery({
    queryKey: ['coherence-metrics', indexName],
    queryFn: async () => {
      const response = await fetch(
        `/api/governance/metrics/coherence?indexName=${encodeURIComponent(
          indexName
        )}&windowMs=${windowMs}`
      );

      if (!response.ok) throw new Error('Failed to fetch coherence metrics');
      return response.json();
    },
    staleTime: 5000,
    refetchInterval: 10000
  });
}

/**
 * Hook to check current coherence health
 * Simple utility for UI indicators
 */
export function useCoherenceHealth(
  indexName: string
): 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN' {
  const { data } = useCacheCoherenceMetrics(indexName);

  if (!data) return 'UNKNOWN';

  const avgLatency = data.averageLatencyMs || 0;
  const failureRate = data.verificationFailureRate || 0;

  if (avgLatency > 5000 || failureRate > 0.1) return 'CRITICAL';
  if (avgLatency > 2000 || failureRate > 0.05) return 'DEGRADED';

  return 'HEALTHY';
}

/**
 * Compose all monitoring for an index
 * Convenience hook that wires up all observability
 */
export function useFullCacheObservability(indexName: string) {
  useCacheCoherenceMonitor(indexName);
  const metrics = useCacheCoherenceMetrics(indexName);
  const health = useCoherenceHealth(indexName);

  return {
    metrics: metrics.data,
    health,
    isLoading: metrics.isLoading,
    error: metrics.error
  };
}
