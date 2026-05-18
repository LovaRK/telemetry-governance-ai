/**
 * useCacheCoherenceMonitor Hook
 *
 * Phase 6.1: Monitors and instruments TanStack Query cache for coherence metrics
 * Tracks invalidation latency, stale render duration, UI/server divergence
 *
 * Usage:
 * const monitor = useCacheCoherenceMonitor('my_index');
 * monitor.recordInvalidation(); // Called when cache invalidation starts
 * monitor.recordRefetch();      // Called when refetch completes
 */

import { useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface CacheCoherenceMetadata {
  indexName: string;
  correlationId: string;
  invalidationInitiatedAt?: number;
  refetchCompletedAt?: number;
  uiReconciliationAt?: number;
}

export function useCacheCoherenceMonitor(indexName: string) {
  const queryClient = useQueryClient();
  const metadataRef = useRef<CacheCoherenceMetadata>({
    indexName,
    correlationId: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  });

  /**
   * Record invalidation initiation
   * Called when TanStack Query cache invalidation is triggered
   */
  const recordInvalidation = useCallback(() => {
    metadataRef.current.invalidationInitiatedAt = performance.now();
  }, []);

  /**
   * Record refetch completion
   * Called when fresh data is received from server
   */
  const recordRefetch = useCallback(() => {
    metadataRef.current.refetchCompletedAt = performance.now();
  }, []);

  /**
   * Record UI reconciliation
   * Called when React has finished updating the DOM
   */
  const recordUiReconciliation = useCallback(async () => {
    metadataRef.current.uiReconciliationAt = performance.now();

    // Only record if we have all three timestamps
    if (
      metadataRef.current.invalidationInitiatedAt &&
      metadataRef.current.refetchCompletedAt &&
      metadataRef.current.uiReconciliationAt
    ) {
      const invalidationLatency =
        metadataRef.current.refetchCompletedAt - metadataRef.current.invalidationInitiatedAt;
      const reconciliationLatency =
        metadataRef.current.uiReconciliationAt - metadataRef.current.refetchCompletedAt;
      const totalDivergenceWindow =
        metadataRef.current.uiReconciliationAt - metadataRef.current.invalidationInitiatedAt;

      // Send to backend for recording
      try {
        await fetch('/api/governance/cache-coherence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indexName,
            correlationId: metadataRef.current.correlationId,
            mutationCommittedAt: new Date(Date.now() - totalDivergenceWindow).toISOString(),
            invalidationRequestedAt: new Date(
              metadataRef.current.invalidationInitiatedAt
            ).toISOString(),
            serverResponseReceivedAt: new Date(
              metadataRef.current.refetchCompletedAt
            ).toISOString(),
            uiRefetchInitiatedAt: new Date(
              metadataRef.current.invalidationInitiatedAt
            ).toISOString(),
            uiAcknowledgedAt: new Date(metadataRef.current.uiReconciliationAt).toISOString(),
            invalidationFailed: false,
            refetchFailed: false,
            uiStillStale: reconciliationLatency > 1000, // Flag if reconciliation took > 1s
          }),
        });
      } catch (error) {
        console.warn('Failed to record cache coherence metrics:', error);
      }

      // Reset for next mutation
      metadataRef.current = {
        indexName,
        correlationId: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };
    }
  }, [indexName]);

  /**
   * Get current metadata (for debugging)
   */
  const getMetadata = useCallback(() => {
    return { ...metadataRef.current };
  }, []);

  return {
    recordInvalidation,
    recordRefetch,
    recordUiReconciliation,
    getMetadata,
    correlationId: metadataRef.current.correlationId,
  };
}

/**
 * Hook to configure TanStack Query with cache coherence metadata
 * Attaches correlation ID and cache timing to query metadata
 */
export function useQueryWithCacheCoherence(
  queryKey: any[],
  options?: {
    staleTime?: number;
    gcTime?: number;
  }
) {
  const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    queryKey,
    meta: {
      correlationId,
      coherenceEnabled: true,
      invalidatedAt: null as number | null,
      refetchedAt: null as number | null,
    },
    ...options,
  };
}
