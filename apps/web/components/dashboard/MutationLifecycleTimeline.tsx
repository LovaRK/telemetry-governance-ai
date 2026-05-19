'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface LifecycleEvent {
  id: string;
  indexName: string;
  sourcetype: string | null;
  fromState: string;
  toState: string;
  transitionReason: string | null;
  actorEmail: string | null;
  durationMs: number;
  recordedAt: string;
}

interface TransitionCount {
  [key: string]: number;
}

const STATE_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  UNDER_REVIEW: '#3b82f6',
  APPROVED: '#22c55e',
  REJECTED: '#ef4444',
  DEFERRED: '#8b5cf6',
  ESCALATED: '#f97316',
  RECONCILED: '#10b981',
  DRAFT: '#94a3b8',
};

const STATE_ICONS: Record<string, string> = {
  PENDING: '⏳',
  UNDER_REVIEW: '👁️',
  APPROVED: '✅',
  REJECTED: '❌',
  DEFERRED: '⏸️',
  ESCALATED: '⬆️',
  RECONCILED: '✓',
  DRAFT: '📝',
};

/**
 * MutationLifecycleTimeline — visualizes governance decision state transitions
 *
 * Displays a timeline of state transitions (PENDING → UNDER_REVIEW → APPROVED/REJECTED → RECONCILED)
 * Shows actor email, transition reason, and duration in each state.
 */
export default function MutationLifecycleTimeline() {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [transitionCounts, setTransitionCounts] = useState<TransitionCount>({});

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/governance/mutation-lifecycle?limit=50');
      if (!res.ok) throw new Error('Failed to fetch mutation lifecycle');

      const json = await res.json();
      setEvents(json.events || []);
      setTransitionCounts(json.transitionCounts || {});
    } catch (e) {
      console.error('Mutation lifecycle fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 15_000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', textAlign: 'center', color: '#64748b' }}>
        Loading mutation lifecycle...
      </div>
    );
  }

  // Group by index for better organization
  const eventsByIndex = new Map<string, LifecycleEvent[]>();
  for (const event of events) {
    if (!eventsByIndex.has(event.indexName)) {
      eventsByIndex.set(event.indexName, []);
    }
    eventsByIndex.get(event.indexName)!.push(event);
  }

  // Sort by most recent
  const sortedIndexes = Array.from(eventsByIndex.keys()).sort(
    (a, b) => {
      const aLatest = eventsByIndex.get(a)![0]?.recordedAt || '';
      const bLatest = eventsByIndex.get(b)![0]?.recordedAt || '';
      return new Date(bLatest).getTime() - new Date(aLatest).getTime();
    }
  );

  return (
    <div style={{ background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>
          🔄 Mutation Lifecycle Timeline
        </div>
        <div style={{ fontSize: '0.65rem', color: '#475569' }}>
          {events.length} transitions tracked
        </div>
      </div>

      {/* Transition Frequency Summary */}
      {Object.keys(transitionCounts).length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: 6, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {Object.entries(transitionCounts).slice(0, 5).map(([transition, count]) => (
            <span key={transition} style={{
              fontSize: '0.65rem',
              padding: '0.25rem 0.5rem',
              background: '#0a0f1a',
              border: '1px solid #334155',
              borderRadius: 3,
              color: '#94a3b8',
            }}>
              {transition} ×{count}
            </span>
          ))}
        </div>
      )}

      {/* Timeline Events */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: 500, overflowY: 'auto' }}>
        {sortedIndexes.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>
            No mutation transitions recorded yet
          </div>
        ) : (
          sortedIndexes.map(indexName => {
            const indexEvents = eventsByIndex.get(indexName) || [];
            const isSelected = selectedIndex === indexName;
            return (
              <div key={indexName}>
                {/* Index Header */}
                <button
                  onClick={() => setSelectedIndex(isSelected ? null : indexName)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: isSelected ? '#1e293b' : 'transparent',
                    border: isSelected ? '1px solid #3b82f6' : '1px solid #334155',
                    borderRadius: 6,
                    color: '#f8fafc',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{indexName}</span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{indexEvents.length} events {isSelected ? '▼' : '▶'}</span>
                </button>

                {/* Timeline */}
                {isSelected && (
                  <div style={{ marginTop: '0.5rem', paddingLeft: '1rem', borderLeft: '2px solid #3b82f6', paddingBottom: '0.75rem' }}>
                    {indexEvents.map((event, idx) => (
                      <div key={event.id} style={{ marginBottom: '0.75rem', position: 'relative' }}>
                        {/* Timeline dot */}
                        <div style={{
                          position: 'absolute',
                          left: -1.5,
                          top: 6,
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: STATE_COLORS[event.toState] || '#64748b',
                          border: '2px solid #0f172a',
                        }} />

                        {/* Event content */}
                        <div style={{
                          paddingLeft: '1rem',
                          padding: '0.5rem 0.75rem',
                          background: `${STATE_COLORS[event.toState] || '#64748b'}10`,
                          border: `1px solid ${STATE_COLORS[event.toState] || '#64748b'}40`,
                          borderRadius: 4,
                          fontSize: '0.7rem',
                        }}>
                          {/* Transition arrow */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: 3 }}>
                            <span style={{ color: STATE_COLORS[event.fromState] || '#94a3b8', fontWeight: 600 }}>
                              {STATE_ICONS[event.fromState] || '•'} {event.fromState}
                            </span>
                            <span style={{ color: '#64748b' }}>→</span>
                            <span style={{ color: STATE_COLORS[event.toState] || '#22c55e', fontWeight: 600 }}>
                              {STATE_ICONS[event.toState] || '•'} {event.toState}
                            </span>
                          </div>

                          {/* Metadata */}
                          <div style={{ color: '#94a3b8', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem', fontSize: '0.65rem' }}>
                            {event.actorEmail && (
                              <div>👤 {event.actorEmail}</div>
                            )}
                            {event.durationMs > 0 && (
                              <div>⏱️ {((event.durationMs) / 1000 / 60).toFixed(0)}m in state</div>
                            )}
                            <div>📅 {new Date(event.recordedAt).toLocaleTimeString()}</div>
                          </div>

                          {/* Reason */}
                          {event.transitionReason && (
                            <div style={{ marginTop: 4, padding: '0.3rem 0.4rem', background: '#0a0f1a', borderRadius: 2, color: '#64748b' }}>
                              📝 {event.transitionReason.slice(0, 80)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: 6, fontSize: '0.65rem', color: '#94a3b8' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>State Colors:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
          {Object.entries(STATE_COLORS).slice(0, 6).map(([state, color]) => (
            <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span>{state}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
