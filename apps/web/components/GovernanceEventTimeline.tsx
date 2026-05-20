'use client';

/**
 * Governance Event Timeline Component
 *
 * Pure projection of the underlying event ledger. Renders both historical and real-time
 * events in monotonic sequence order. The UI is deterministic: whether an event occurred
 * 3 days ago or 3 milliseconds ago, it renders identically.
 *
 * Architecture:
 * 1. Bootstrap: Fetch full historical timeline via /api/governance/executions/{id}/timeline
 * 2. Stream: Connect SSE to /api/governance/events/stream for real-time updates
 * 3. Merge: Deduplication logic prevents rendering the same sequence twice
 * 4. Render: Format events with timeline integrity status badge
 */

import React, { useEffect, useState } from 'react';

interface ControlPlaneEvent {
  sequence: number;
  event_id: string;
  event_type: string;
  taxonomy: string;
  severity: string;
  actor?: string;
  message: string;
  timestamp: string;
  payload?: Record<string, any>;
  governance?: Record<string, any>;
  _source?: 'HISTORICAL' | 'REALTIME';
}

interface TimelineState {
  events: ControlPlaneEvent[];
  integrity: string;
  loading: boolean;
  error?: string;
}

export function GovernanceEventTimeline({ executionId }: { executionId: string }) {
  const [state, setState] = useState<TimelineState>({
    events: [],
    integrity: 'CHECKING',
    loading: true,
  });

  useEffect(() => {
    if (!executionId) {
      setState(prev => ({
        ...prev,
        error: 'No execution_id provided',
        loading: false,
      }));
      return;
    }

    let eventSource: EventSource | null = null;
    let isMounted = true;

    const bootstrap = async () => {
      try {
        // Step 1: Hydrate full historical state via Timeline Replay Endpoint
        const timelineRes = await fetch(`/api/governance/executions/${executionId}/timeline`);
        const timelineData = await timelineRes.json();

        if (!timelineRes.ok || !timelineData.timeline) {
          if (isMounted) {
            setState(prev => ({
              ...prev,
              error: `Timeline bootstrap failed: ${timelineData.error || 'Unknown error'}`,
              loading: false,
            }));
          }
          return;
        }

        if (isMounted) {
          setState(prev => ({
            ...prev,
            events: timelineData.timeline || [],
            integrity: timelineData.timeline_integrity_status || 'UNKNOWN',
            loading: false,
          }));
        }

        // Step 2: Connect real-time SSE stream
        eventSource = new EventSource(`/api/governance/events/stream?execution_id=${executionId}`);

        eventSource.addEventListener('CONTROL_PLANE_UPDATE', (e: Event) => {
          try {
            const messageEvent = e as MessageEvent;
            const parsedEvent: ControlPlaneEvent = JSON.parse(messageEvent.data);

            if (!isMounted) return;

            setState(prev => {
              // Deduplication: prevent rendering same sequence twice
              if (prev.events.some(item => item.sequence === parsedEvent.sequence)) {
                return prev;
              }

              // Insert new event and re-sort (should already be in order, but be safe)
              const updated = [...prev.events, parsedEvent].sort((a, b) => a.sequence - b.sequence);

              return {
                ...prev,
                events: updated,
              };
            });
          } catch (err) {
            console.error('[EventTimeline] Failed to parse SSE event:', err);
          }
        });

        eventSource.addEventListener('KEEP_ALIVE', () => {
          // Heartbeat from server; client connection is alive
        });

        eventSource.addEventListener('error', (err) => {
          console.error('[EventTimeline] SSE connection error:', err);
          if (isMounted) {
            setState(prev => ({
              ...prev,
              error: 'Real-time stream disconnected',
            }));
          }
        });
      } catch (err) {
        console.error('[EventTimeline] Bootstrap error:', err);
        if (isMounted) {
          setState(prev => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Unknown error',
            loading: false,
          }));
        }
      }
    };

    bootstrap();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [executionId]);

  const getSeverityBadgeColor = (severity?: string): string => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-900 text-red-200';
      case 'HIGH':
      case 'WARN':
        return 'bg-amber-900 text-amber-200';
      case 'INFO':
      case 'DEBUG':
        return 'bg-slate-800 text-slate-400';
      default:
        return 'bg-slate-900 text-slate-400';
    }
  };

  const getIntegrityBadgeColor = (integrity: string): string => {
    if (integrity.startsWith('INTEG_OK')) return 'bg-emerald-950 text-emerald-400';
    if (integrity.startsWith('INTEG_COMPROMISED')) return 'bg-rose-950 text-rose-400';
    return 'bg-slate-900 text-slate-400';
  };

  return (
    <div className="bg-slate-950 p-6 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center pb-3 border-b border-slate-900">
        <div className="flex items-center gap-2">
          <span className="text-base">📡</span>
          <span className="font-bold tracking-widest text-slate-300">
            CONTROL PLANE OPERATIONAL NARRATIVE
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <span
            className={`px-2 py-1 rounded text-[10px] font-semibold ${getIntegrityBadgeColor(
              state.integrity
            )}`}
          >
            {state.integrity}
          </span>
          {state.loading && <span className="text-slate-500 text-[10px]">⟳ Loading...</span>}
        </div>
      </div>

      {/* Error state */}
      {state.error && (
        <div className="bg-rose-950 border border-rose-800 rounded p-3 text-rose-200 text-xs">
          <span className="font-semibold">⚠ Error:</span> {state.error}
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {state.events.length === 0 && !state.loading ? (
          <div className="text-slate-500 text-center py-6">
            No events recorded for this execution
          </div>
        ) : state.events.length === 0 ? (
          <div className="text-slate-500 text-center py-6 animate-pulse">
            Establishing stream authorization framework...
          </div>
        ) : (
          state.events.map((evt, idx) => (
            <div
              key={`${evt.sequence}-${evt.event_id}`}
              className="border-l-2 border-slate-800 pl-3 ml-2 pb-2"
            >
              {/* Event header: timestamp, type, sequence */}
              <div className="flex gap-3 items-start mb-1">
                <span className="text-slate-600 min-w-[120px]">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                <div className="flex gap-2 items-center flex-wrap">
                  <span
                    className={`font-semibold tracking-wider uppercase px-2 py-0.5 rounded text-[9px] ${getSeverityBadgeColor(
                      evt.severity
                    )}`}
                  >
                    {evt.event_type}
                  </span>
                  <span className="text-slate-600 text-[10px]">seq:{evt.sequence}</span>
                  {evt._source === 'REALTIME' && (
                    <span className="text-emerald-500 text-[9px] font-semibold">● LIVE</span>
                  )}
                </div>
              </div>

              {/* Event message */}
              <p className="text-slate-200 text-xs leading-relaxed ml-0 mb-1">{evt.message}</p>

              {/* Event metadata */}
              {(evt.actor || evt.governance) && (
                <div className="text-slate-500 text-[10px] ml-0 space-y-0.5">
                  {evt.actor && <div>Actor: {evt.actor}</div>}
                  {evt.governance?.matched_policies && (
                    <div>Policies: {evt.governance.matched_policies.join(', ')}</div>
                  )}
                  {evt.governance?.requires_approval && (
                    <div className="text-amber-400">⚠ Approval required</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer: Timeline summary */}
      {state.events.length > 0 && (
        <div className="pt-3 border-t border-slate-900 text-[10px] text-slate-500 space-y-0.5">
          <div>Events recorded: {state.events.length}</div>
          <div>
            Duration:{' '}
            {(() => {
              const first = new Date(state.events[0].timestamp).getTime();
              const last = new Date(state.events[state.events.length - 1].timestamp).getTime();
              const ms = last - first;
              if (ms < 1000) return `${ms}ms`;
              return `${(ms / 1000).toFixed(1)}s`;
            })()}
          </div>
          <div>Sequence integrity: {state.integrity}</div>
        </div>
      )}
    </div>
  );
}
