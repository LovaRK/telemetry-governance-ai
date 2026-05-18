/**
 * Complete Example: Governance Settings Index with Full Observability
 *
 * This demonstrates how to integrate:
 * 1. useTelemetryWrappedMutations - Frontend trace generation
 * 2. useCacheCoherenceMonitor - Cache health tracking
 * 3. TanStack Query - Data fetching with trace context
 *
 * Result: Complete causal chain from user intent through cache verification
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useTelemetryWrappedMutations,
  useTelemetryMutation,
  GovernanceMutationPayload
} from '@/hooks/useTelemetryWrappedMutations';
import {
  useCacheCoherenceMonitor,
  useFullCacheObservability
} from '@/hooks/useCacheCoherenceMonitor';

const INDEX_NAME = 'governance_settings';

/**
 * Component demonstrating Phase 1 boundary integration
 */
export function GovernanceSettingsIndex() {
  const [editMode, setEditMode] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});

  // === Hook 1: Enable cache coherence monitoring for this index ===
  // This automatically tracks all cache invalidations and emits telemetry
  const { metrics, health } = useFullCacheObservability(INDEX_NAME);

  // === Hook 2: Fetch settings with TanStack Query ===
  const { data: settings, isLoading } = useQuery({
    queryKey: ['governance-index', INDEX_NAME],
    queryFn: async () => {
      const response = await fetch(`/api/governance/indices/${INDEX_NAME}`);
      if (!response.ok) throw new Error('Failed to fetch settings');
      return response.json();
    },
    staleTime: 30000
  });

  // === Hook 3: Create mutation with trace propagation ===
  // This wraps the mutation to:
  // - Generate W3C traceparent header
  // - Fire INTENT_RECEIVED before transport
  // - Attach trace context to headers
  // - Correlate with cache coherence monitoring
  const saveMutation = useTelemetryMutation<void>(
    INDEX_NAME,
    'DIRECT_MUTATION'
  );

  const handleSaveSettings = async () => {
    try {
      // Fire mutation with telemetry wrapper
      const result = await saveMutation.mutateAsync({
        ...pendingChanges,
        indexName: INDEX_NAME
      });

      console.log('Mutation successful', {
        trace: result.trace,
        serverTopology: result.serverResponse?.topology
      });

      setEditMode(false);
      setPendingChanges({});
    } catch (err) {
      console.error('Mutation failed:', err);
    }
  };

  return (
    <div className="governance-settings-container">
      <h1>Governance Settings</h1>

      {/* Health indicator from cache coherence monitoring */}
      <div className="health-indicator">
        <span className={`status-badge ${health}`}>
          Cache Health: {health}
        </span>
        {metrics && (
          <span className="metrics-summary">
            Avg latency: {metrics.metrics.averageLatencyMs.toFixed(0)}ms |
            P95: {metrics.metrics.p95LatencyMs.toFixed(0)}ms
          </span>
        )}
      </div>

      {/* Settings form */}
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <form>
          <fieldset disabled={saveMutation.isPending}>
            {Object.entries(settings || {}).map(([key, value]) => (
              <div key={key} className="form-group">
                <label>{key}</label>
                <input
                  type="text"
                  value={editMode ? pendingChanges[key] ?? value : (value as string)}
                  onChange={(e) => {
                    setPendingChanges((prev) => ({
                      ...prev,
                      [key]: e.target.value
                    }));
                  }}
                  disabled={!editMode}
                />
              </div>
            ))}

            <div className="button-group">
              {!editMode ? (
                <button type="button" onClick={() => setEditMode(true)}>
                  Edit Settings
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setPendingChanges({});
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </fieldset>

          {saveMutation.error && (
            <div className="error">
              Save failed: {saveMutation.error.message}
            </div>
          )}
        </form>
      )}

      {/* Trace context display (debug panel) */}
      {process.env.NODE_ENV === 'development' && saveMutation.data && (
        <details className="trace-debug-panel">
          <summary>Trace Context (Debug)</summary>
          <pre>
            {JSON.stringify(
              {
                traceId: saveMutation.data.trace.traceId,
                spanId: saveMutation.data.trace.spanId,
                correlationId: saveMutation.data.trace.correlationId,
                executionClass: saveMutation.data.trace.executionClass,
                serverTopology: saveMutation.data.serverResponse?.topology,
                latency: Date.now() - saveMutation.data.trace.clientInitiatedAt
              },
              null,
              2
            )}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Example: Mutation with CACHE_INVALIDATING execution class
 *
 * Use this when your mutation invalidates the entire cache
 * (not just a single query)
 */
export function GovernanceSettingsIndexWithBulkInvalidation() {
  const bulkMutation = useTelemetryMutation(INDEX_NAME, 'CACHE_INVALIDATING');

  const handleBulkRefresh = async () => {
    await bulkMutation.mutateAsync({
      action: 'refresh_all',
      indexName: INDEX_NAME
    });
  };

  return (
    <button onClick={handleBulkRefresh} disabled={bulkMutation.isPending}>
      {bulkMutation.isPending ? 'Refreshing...' : 'Refresh All Settings'}
    </button>
  );
}

/**
 * Example: Trace timeline viewer (debug utility)
 *
 * Shows the complete lifecycle of a trace from INTENT_RECEIVED
 * through UI_RECONCILED
 */
export function TraceTimelineViewer({ traceId }: { traceId: string }) {
  const { data: timeline, isLoading } = useQuery({
    queryKey: ['trace-timeline', traceId],
    queryFn: async () => {
      const response = await fetch(
        `/api/governance/trace/${traceId}/timeline`
      );
      if (!response.ok) throw new Error('Failed to fetch timeline');
      return response.json();
    },
    enabled: !!traceId
  });

  if (!traceId) return <div>No trace selected</div>;
  if (isLoading) return <div>Loading timeline...</div>;

  return (
    <div className="trace-timeline">
      <h3>Trace {traceId.substring(0, 8)}...</h3>
      <div className="timeline-events">
        {timeline?.events.map((event: any, idx: number) => (
          <div key={idx} className="timeline-event">
            <span className="event-state">{event.lifecycle_state}</span>
            <span className="event-status">{event.status}</span>
            {event.error_message && (
              <span className="event-error">{event.error_message}</span>
            )}
            <span className="event-duration">
              +{event.duration_in_state_ms}ms
            </span>
          </div>
        ))}
      </div>
      <div className="timeline-summary">
        Total duration: {timeline?.durationMs}ms ({timeline?.eventCount} events)
      </div>
    </div>
  );
}

/**
 * CSS Styling (add to your stylesheet)
 */
const styles = `
.governance-settings-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.health-indicator {
  display: flex;
  gap: 12px;
  margin: 20px 0;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: bold;
}

.status-badge.HEALTHY {
  background: #c6f6d5;
  color: #22543d;
}

.status-badge.DEGRADED {
  background: #fed7d7;
  color: #742a2a;
}

.status-badge.CRITICAL {
  background: #fed7d7;
  color: #742a2a;
}

.trace-debug-panel {
  margin-top: 20px;
  padding: 12px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.trace-timeline {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.timeline-events {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}

.timeline-event {
  display: grid;
  grid-template-columns: 150px 80px 200px 100px;
  gap: 8px;
  padding: 8px;
  background: #f9f9f9;
  border-left: 3px solid #007bff;
  font-size: 12px;
}

.event-state {
  font-weight: bold;
}

.event-error {
  color: #d32f2f;
}

.event-duration {
  text-align: right;
  color: #666;
}
`;
