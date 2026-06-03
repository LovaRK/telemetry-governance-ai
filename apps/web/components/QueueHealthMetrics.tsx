'use client';
import { apiFetch } from '../lib/api-client';

import { useState, useEffect } from 'react';

interface QueueMetrics {
  snapshotDate: string;
  reuseRatio: number;
  filteringEfficiencyPct: number;
  highConfidenceProposals: number;
  mediumConfidenceProposals: number;
  lowConfidenceProposals: number;
  decisionFlipRate: number;
}

export function QueueHealthMetrics() {
  const [metrics, setMetrics] = useState<QueueMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<QueueMetrics | null>(null);

  useEffect(() => {
    fetchQueueMetrics();
  }, []);

  const fetchQueueMetrics = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/queue-health?limit=30');
      const result = await res.json();

      if (result.mode === 'DEMO_MODE') {
        setError('Database not available');
        setMetrics([]);
        return;
      }

      const data = result.data || [];
      setMetrics(data);
      if (data.length > 0) {
        setLatestMetrics(data[0]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  };

  const getHealthColor = (value: number, target: number, isHigherBetter: boolean) => {
    if (isHigherBetter) {
      if (value >= target) return '#4caf50'; // green
      if (value >= target * 0.75) return '#ff9800'; // orange
      return '#f44336'; // red
    } else {
      if (value <= target) return '#4caf50'; // green
      if (value <= target / 0.75) return '#ff9800'; // orange
      return '#f44336'; // red
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: '#666' }}>Loading metrics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: '#d32f2f', backgroundColor: '#ffebee', borderRadius: '8px' }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (!latestMetrics) {
    return (
      <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', textAlign: 'center', color: '#666' }}>
        <p style={{ marginBottom: '8px', fontWeight: 600 }}>⏳ No queue metrics yet</p>
        <p style={{ fontSize: '0.9rem', color: '#999', margin: 0 }}>
          Queue metrics appear after the first aggregation pipeline job completes. Run "Refresh" on the dashboard to populate this section.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f0f8ff', border: '1px solid #b0d4ff', borderRadius: '6px', fontSize: '0.85rem', color: '#1565c0', lineHeight: '1.4' }}>
        <strong>ℹ️ Queue Health:</strong> Monitors the aggregation pipeline health. Includes metadata reuse consistency, query filtering efficiency, and LLM decision stability. High reuse ratio = stable indexes. Low flip rate = consistent recommendations.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ marginBottom: 0, color: '#333' }}>Queue Health Metrics</h2>
        <button
          onClick={fetchQueueMetrics}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Refresh
        </button>
      </div>

      {/* Alert Box */}
      {latestMetrics.reuseRatio < 0.75 && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px',
            backgroundColor: '#fff3e0',
            border: '2px solid #ff9800',
            borderRadius: '8px',
            color: '#e65100'
          }}
        >
          <strong>⚠️ Alert: Low Reuse Ratio</strong>
          <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
            Reuse ratio is {(latestMetrics.reuseRatio * 100).toFixed(1)}% (target: {'>'} 90%). This indicates potentially unstable metadata fingerprinting or significant index changes.
          </p>
        </div>
      )}

      {/* Key Metrics Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Reuse Ratio */}
        <div style={{
          padding: '16px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          backgroundColor: '#fafafa'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#666', fontSize: '14px' }}>Reuse Ratio (target: {'>'} 0.90)</span>
            <span style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: getHealthColor(latestMetrics.reuseRatio, 0.90, true)
            }}>
              {(latestMetrics.reuseRatio * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{
            height: '8px',
            backgroundColor: '#e0e0e0',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '100%',
                backgroundColor: getHealthColor(latestMetrics.reuseRatio, 0.90, true),
                width: `${Math.min(latestMetrics.reuseRatio * 100, 100)}%`
              }}
            />
          </div>
        </div>

        {/* Filtering Efficiency */}
        <div style={{
          padding: '16px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          backgroundColor: '#fafafa'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#666', fontSize: '14px' }}>Filtering Efficiency (target: {'<'} 10%)</span>
            <span style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: getHealthColor(latestMetrics.filteringEfficiencyPct, 10, false)
            }}>
              {latestMetrics.filteringEfficiencyPct.toFixed(1)}%
            </span>
          </div>
          <div style={{
            height: '8px',
            backgroundColor: '#e0e0e0',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '100%',
                backgroundColor: getHealthColor(latestMetrics.filteringEfficiencyPct, 10, false),
                width: `${Math.min(latestMetrics.filteringEfficiencyPct, 100)}%`
              }}
            />
          </div>
        </div>

        {/* Decision Flip Rate */}
        <div style={{
          padding: '16px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          backgroundColor: '#fafafa'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#666', fontSize: '14px' }}>Decision Flip Rate (target: {'<'} 5%)</span>
            <span style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: getHealthColor(latestMetrics.decisionFlipRate, 0.05, false)
            }}>
              {(latestMetrics.decisionFlipRate * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{
            height: '8px',
            backgroundColor: '#e0e0e0',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '100%',
                backgroundColor: getHealthColor(latestMetrics.decisionFlipRate, 0.05, false),
                width: `${Math.min(latestMetrics.decisionFlipRate * 100, 100)}%`
              }}
            />
          </div>
        </div>
      </div>

      {/* Confidence Distribution */}
      <div style={{
        padding: '16px',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        backgroundColor: '#fafafa'
      }}>
        <h3 style={{ marginBottom: '16px', color: '#333', fontSize: '16px' }}>
          Proposal Confidence Distribution
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4caf50' }}>
              {latestMetrics.highConfidenceProposals}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              High Confidence (≥0.95)
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff9800' }}>
              {latestMetrics.mediumConfidenceProposals}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              Medium Confidence (0.70-0.95)
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f44336' }}>
              {latestMetrics.lowConfidenceProposals}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              Low Confidence ({'<'} 0.70)
            </div>
          </div>
        </div>
      </div>

      {/* Metrics History */}
      {metrics.length > 1 && (
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ marginBottom: '12px', color: '#333' }}>Metrics History (Last 30 snapshots)</h3>
          <div style={{
            overflowX: 'auto',
            border: '1px solid #e0e0e0',
            borderRadius: '8px'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px'
            }}>
              <thead style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
                <tr>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#666', fontWeight: '600' }}>Date</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#666', fontWeight: '600' }}>Reuse Ratio</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#666', fontWeight: '600' }}>Filtering %</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#666', fontWeight: '600' }}>Flip Rate</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#666', fontWeight: '600' }}>High Conf</th>
                </tr>
              </thead>
              <tbody>
                {metrics.slice(0, 10).map((m, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '12px', color: '#333' }}>{m.snapshotDate}</td>
                    <td style={{
                      padding: '12px',
                      textAlign: 'right',
                      color: getHealthColor(m.reuseRatio, 0.90, true),
                      fontWeight: '500'
                    }}>
                      {(m.reuseRatio * 100).toFixed(1)}%
                    </td>
                    <td style={{
                      padding: '12px',
                      textAlign: 'right',
                      color: getHealthColor(m.filteringEfficiencyPct, 10, false),
                      fontWeight: '500'
                    }}>
                      {m.filteringEfficiencyPct.toFixed(1)}%
                    </td>
                    <td style={{
                      padding: '12px',
                      textAlign: 'right',
                      color: getHealthColor(m.decisionFlipRate, 0.05, false),
                      fontWeight: '500'
                    }}>
                      {(m.decisionFlipRate * 100).toFixed(1)}%
                    </td>
                    <td style={{
                      padding: '12px',
                      textAlign: 'right',
                      color: '#666'
                    }}>
                      {m.highConfidenceProposals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
