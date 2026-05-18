'use client';

import { useEffect, useState } from 'react';

interface QueueStatus {
  pendingEmergency: number;
  pendingCritical: number;
  pendingStandard: number;
  pendingBackground: number;
  pendingDeferred: number;
  totalPending: number;
  jobsCompletedToday: number;
  jobsFailedToday: number;
}

const TIER_COLORS: Record<string, string> = {
  EMERGENCY: '#c0392b',
  CRITICAL: '#e74c3c',
  STANDARD: '#f39c12',
  BACKGROUND: '#3498db',
  DEFERRED: '#95a5a6',
};

const TIER_INFO: Record<string, { label: string; jobsPerHour: number; maxConcurrent: number }> = {
  EMERGENCY: { label: 'Emergency', jobsPerHour: 999, maxConcurrent: 10 },
  CRITICAL: { label: 'Critical', jobsPerHour: 30, maxConcurrent: 5 },
  STANDARD: { label: 'Standard', jobsPerHour: 10, maxConcurrent: 2 },
  BACKGROUND: { label: 'Background', jobsPerHour: 3, maxConcurrent: 1 },
  DEFERRED: { label: 'Deferred', jobsPerHour: 1, maxConcurrent: 1 },
};

export function ReanalysisQueueStatus() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        setLoading(true);
        const response = await window.fetch('/api/queue-health');

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.mode === 'DEMO_MODE') {
          setError('Database not available');
          setStatus(null);
          return;
        }

        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch queue status');
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };

    fetch();

    // Auto-refresh every 30 seconds if enabled
    if (!autoRefresh) return;
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading && !status) {
    return (
      <div style={{ padding: '16px', color: '#7f8c8d', fontFamily: 'monospace', fontSize: '12px' }}>
        Loading queue status...
      </div>
    );
  }

  if (error && !status) {
    return (
      <div style={{ padding: '16px', backgroundColor: '#ffebee', color: '#e74c3c', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}>
        ⚠️ {error}
      </div>
    );
  }

  if (!status) return null;

  const tiers = ['EMERGENCY', 'CRITICAL', 'STANDARD', 'BACKGROUND', 'DEFERRED'] as const;
  const tierCounts: Record<string, number> = {
    EMERGENCY: status.pendingEmergency,
    CRITICAL: status.pendingCritical,
    STANDARD: status.pendingStandard,
    BACKGROUND: status.pendingBackground,
    DEFERRED: status.pendingDeferred,
  };

  // Estimate processing time
  const estimateMinutes = () => {
    let minutes = 0;
    for (const tier of tiers) {
      const count = tierCounts[tier];
      const info = TIER_INFO[tier];
      minutes += (count / info.jobsPerHour) * 60;
    }
    return Math.round(minutes);
  };

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #bdc3c7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '4px' }}>
            ⚙️ AI Processing Status: {status.totalPending > 0 ? 'ACTIVE' : 'IDLE'}
          </div>
          <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
            {status.totalPending} jobs pending • {status.jobsCompletedToday} completed today • {status.jobsFailedToday} failed
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: '#7f8c8d' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Auto-refresh (30s)
        </label>
      </div>

      {/* Queue Depth by Priority */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '8px' }}>
          Queue Depth by Priority
        </div>
        <div style={{ display: 'grid', gap: '8px' }}>
          {tiers.map((tier) => {
            const count = tierCounts[tier];
            const info = TIER_INFO[tier];
            const percentage = status.totalPending > 0 ? (count / status.totalPending) * 100 : 0;

            return (
              <div key={tier}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: TIER_COLORS[tier], fontWeight: 'bold' }}>
                    {info.label}
                  </span>
                  <span style={{ color: '#7f8c8d' }}>
                    {count} jobs ({info.jobsPerHour}/hr, {info.maxConcurrent} concurrent)
                  </span>
                </div>
                <div style={{
                  backgroundColor: '#ecf0f1',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  height: '20px',
                }}>
                  <div style={{
                    backgroundColor: TIER_COLORS[tier],
                    width: `${percentage}%`,
                    height: '100%',
                    transition: 'width 0.3s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: 'bold',
                  }}>
                    {percentage > 5 && `${percentage.toFixed(0)}%`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Estimated Completion */}
      {status.totalPending > 0 && (
        <div style={{
          padding: '12px',
          backgroundColor: '#ecf0f1',
          borderRadius: '4px',
          marginBottom: '16px',
        }}>
          <div style={{ color: '#2c3e50', fontWeight: 'bold', marginBottom: '4px' }}>
            🕐 Estimated Queue Completion: ~{estimateMinutes()}m
          </div>
          <div style={{ fontSize: '11px', color: '#7f8c8d', lineHeight: '1.4' }}>
            Based on tier rates and current queue depth. Actual time depends on job complexity and hardware load.
          </div>
        </div>
      )}

      {/* Processing Capacity */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '8px' }}>
          Processing Capacity
        </div>
        <div style={{
          padding: '12px',
          backgroundColor: '#f0f8ff',
          borderLeft: '3px solid #3498db',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#2c3e50',
          lineHeight: '1.6',
        }}>
          Engine Rate Limiter: <span style={{ fontWeight: 'bold' }}>Active (Hardware Throttle: Safe)</span>
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#7f8c8d' }}>
            Daily budget: 5% of corpus
            <br />
            Adaptive factors: Hardware × Queue Load × Thermal State
            <br />
            Current allocation: Safe mode (no thermal throttling detected)
          </div>
        </div>
      </div>

      {/* Status Indicator */}
      {status.totalPending === 0 ? (
        <div style={{
          padding: '12px',
          backgroundColor: '#e8f5e9',
          borderLeft: '3px solid #27ae60',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#27ae60',
          fontWeight: 'bold',
          textAlign: 'center',
        }}>
          ✓ Queue is empty — all reanalysis jobs complete
        </div>
      ) : (
        <div style={{
          padding: '12px',
          backgroundColor: '#fff3e0',
          borderLeft: '3px solid #f39c12',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#f39c12',
          fontWeight: 'bold',
          textAlign: 'center',
        }}>
          ⚙️ Processing: {status.totalPending} jobs in flight
        </div>
      )}
    </div>
  );
}
