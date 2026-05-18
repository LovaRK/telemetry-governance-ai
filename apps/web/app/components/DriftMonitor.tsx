'use client';

import { useEffect, useState } from 'react';
import { TrustInspectionModal } from './TrustInspectionModal';

interface DriftEvent {
  index_name: string;
  drift_status: 'STABLE' | 'NOISE' | 'METRIC_DRIFT' | 'SEMANTIC_DRIFT' | 'POLICY_DRIFT';
  severity_score: number;
  drift_reason: string;
  evaluated_at: string;
  confidence_score: number;
  is_queued_for_reanalysis: boolean;
  priority_tier: string | null;
}

interface DriftMonitorProps {
  limit?: number;
}

const STATUS_COLORS: Record<string, string> = {
  'STABLE': '#27ae60',
  'NOISE': '#95a5a6',
  'METRIC_DRIFT': '#f39c12',
  'SEMANTIC_DRIFT': '#e74c3c',
  'POLICY_DRIFT': '#8e44ad',
};

const PRIORITY_COLORS: Record<string, string> = {
  'EMERGENCY': '#c0392b',
  'CRITICAL': '#e74c3c',
  'STANDARD': '#f39c12',
  'BACKGROUND': '#95a5a6',
  'DEFERRED': '#bdc3c7',
};

export function DriftMonitor({ limit = 50 }: DriftMonitorProps) {
  const [driftEvents, setDriftEvents] = useState<DriftEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectionIndexName, setInspectionIndexName] = useState<string | null>(null);

  useEffect(() => {
    const fetchDriftEvents = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/drift-monitor?limit=${limit}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.mode === 'DEMO_MODE') {
          setError('Database not available');
          setDriftEvents([]);
          return;
        }

        setDriftEvents(data.driftEvents || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch drift events');
        setDriftEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDriftEvents();
  }, [limit]);

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#7f8c8d', fontFamily: 'monospace', fontSize: '12px' }}>
        Loading drift events...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: '#ffebee', color: '#e74c3c', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}>
        ⚠️ {error}
      </div>
    );
  }

  if (driftEvents.length === 0) {
    return (
      <div style={{ padding: '16px', color: '#27ae60', fontFamily: 'monospace', fontSize: '12px', textAlign: 'center' }}>
        ✓ No active drift detected across monitored indexes
      </div>
    );
  }

  // Group by severity
  const grouped = {
    POLICY_DRIFT: driftEvents.filter(e => e.drift_status === 'POLICY_DRIFT'),
    SEMANTIC_DRIFT: driftEvents.filter(e => e.drift_status === 'SEMANTIC_DRIFT'),
    METRIC_DRIFT: driftEvents.filter(e => e.drift_status === 'METRIC_DRIFT'),
    NOISE: driftEvents.filter(e => e.drift_status === 'NOISE'),
    STABLE: driftEvents.filter(e => e.drift_status === 'STABLE'),
  };

  return (
    <div>
      {/* Summary Statistics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        <div style={{
          padding: '12px',
          backgroundColor: '#fff3e0',
          borderLeft: `4px solid ${STATUS_COLORS.SEMANTIC_DRIFT}`,
          borderRadius: '4px',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#e74c3c' }}>
            {grouped.SEMANTIC_DRIFT.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Semantic Drift (requires reanalysis)</div>
        </div>

        <div style={{
          padding: '12px',
          backgroundColor: '#fef5e7',
          borderLeft: `4px solid ${STATUS_COLORS.METRIC_DRIFT}`,
          borderRadius: '4px',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f39c12' }}>
            {grouped.METRIC_DRIFT.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Metric Drift (monitoring)</div>
        </div>

        <div style={{
          padding: '12px',
          backgroundColor: '#f4f1de',
          borderLeft: `4px solid ${STATUS_COLORS.POLICY_DRIFT}`,
          borderRadius: '4px',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#8e44ad' }}>
            {grouped.POLICY_DRIFT.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Policy Drift (invalidated)</div>
        </div>

        <div style={{
          padding: '12px',
          backgroundColor: '#ecf0f1',
          borderLeft: `4px solid ${STATUS_COLORS.NOISE}`,
          borderRadius: '4px',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#95a5a6' }}>
            {grouped.NOISE.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Noise (false positives)</div>
        </div>
      </div>

      {/* Drift Events by Category */}
      {Object.entries(grouped).map(([status, events]) => {
        if (events.length === 0) return null;

        return (
          <div key={status} style={{ marginBottom: '24px' }}>
            <div style={{
              fontSize: '13px',
              fontWeight: 'bold',
              color: STATUS_COLORS[status],
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: `2px solid ${STATUS_COLORS[status]}`,
            }}>
              {status} ({events.length})
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              {events.map((event, idx) => (
                <div
                  key={`${event.index_name}-${idx}`}
                  style={{
                    padding: '12px',
                    backgroundColor: '#fff',
                    border: `1px solid ${STATUS_COLORS[status]}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onClick={() => setInspectionIndexName(event.index_name)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#f9f9f9';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#fff';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 'bold', color: '#2c3e50', fontSize: '13px' }}>
                      {event.index_name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={{
                        fontSize: '10px',
                        backgroundColor: STATUS_COLORS[status],
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '3px',
                      }}>
                        {(event.severity_score * 100).toFixed(0)}% severity
                      </span>
                      {event.is_queued_for_reanalysis && (
                        <span style={{
                          fontSize: '10px',
                          backgroundColor: PRIORITY_COLORS[event.priority_tier || 'STANDARD'],
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                        }}>
                          ⚙️ {event.priority_tier || 'STANDARD'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px', lineHeight: '1.4' }}>
                    {event.drift_reason}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#999' }}>
                    <span>Confidence: {(event.confidence_score * 100).toFixed(0)}%</span>
                    <span>Evaluated: {new Date(event.evaluated_at).toLocaleString()}</span>
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '10px', color: '#3498db', fontWeight: 'bold', cursor: 'pointer' }}>
                    → Click to inspect full trust state
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Trust Inspection Modal */}
      <TrustInspectionModal
        indexName={inspectionIndexName || ''}
        isOpen={inspectionIndexName !== null}
        onClose={() => setInspectionIndexName(null)}
      />
    </div>
  );
}
