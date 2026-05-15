'use client';

import { useState, useEffect } from 'react';

interface Decision {
  index_name: string;
  action: string;
  savings: number;
  risk: number;
  confidence: number;
  confidence_level: string;
  confidence_signals: { name: string; status: string; detail: string }[];
  reason: string;
  impact_score: number;
  trend: string;
  trend_percent: number;
  days_since_last_event: number;
  utilization: number;
  blast_radius: { dashboards: number; alerts: number; users: number; score: number; level: string };
  safe_to_delete: boolean;
}

interface Props {
  decisions?: Decision[];
  onAction?: (index: string, action: string, status: 'APPROVED' | 'IGNORED' | 'REVERTED') => void;
}

interface Summary {
  total_savings: number;
  high_risk_count: number;
  safe_actions_count: number;
  roi_percent: number;
}

export default function AgentIntelligencePanel({ decisions = [], onAction }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ top_decisions: Decision[]; quick_wins: Decision[]; total_potential_savings: number; summary?: Summary } | null>(null);
  const [actionStatus, setActionStatus] = useState<{ status: string; action: string } | null>(null);

  useEffect(() => {
    if (decisions.length > 0) {
      setData({ top_decisions: decisions, quick_wins: [], total_potential_savings: decisions.reduce((s, d) => s + d.savings, 0) });
    }
  }, []);

  const handleAction = async (index: string, action: string, status: 'APPROVED' | 'IGNORED' | 'REVERTED') => {
    setLoading(true);
    try {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index_name: index, action, status })
      });

      const result = await res.json();

      if (!res.ok) {
        setActionStatus({ status: `⚠️ ${result.error}`, action: '' });
        return;
      }

      setActionStatus({ status: `✓ ${result.message}`, action: status === 'REVERTED' ? '' : status });
      onAction?.(index, action, status);
    } catch (e: any) {
      setActionStatus({ status: `⚠️ ${e.message}`, action: '' });
    } finally {
      setLoading(false);
    }
  };

  const top = data?.top_decisions?.[0];

  if (!data) {
    return null;
  }

  const actionColor = {
    ELIMINATE: '#ef4444',
    ARCHIVE: '#3b82f6',
    OPTIMIZE: '#f59e0b',
    INVESTIGATE: '#8b5cf6',
  }[top?.action || ''] || '#94a3b8';

  // Quick wins section
  const quickWins = data?.quick_wins || [];

  return (
    <div style={{
      marginBottom: '1.5rem',
      padding: '1.5rem',
      background: '#0f172a',
      borderRadius: '12px',
      border: '1px solid #1e293b',
    }}>
      {/* Decision Summary Strip */}
      {data?.summary && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '0.75rem 1rem',
          background: '#1e293b',
          borderRadius: '8px',
          marginBottom: '1rem',
          fontSize: '0.875rem',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '1.125rem' }}>
              ${Math.round(data.summary.total_savings / 1000)}k
            </div>
            <div style={{ color: '#64748b', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Savings</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: data.summary.high_risk_count > 0 ? '#ef4444' : '#94a3b8', fontWeight: 700, fontSize: '1.125rem' }}>
              {data.summary.high_risk_count}
            </div>
            <div style={{ color: '#64748b', fontSize: '0.6875rem', textTransform: 'uppercase' }}>High Risk</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '1.125rem' }}>
              {data.summary.safe_actions_count}
            </div>
            <div style={{ color: '#64748b', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Safe Actions</div>
          </div>
          {data.summary.roi_percent > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#8b5cf6', fontWeight: 700, fontSize: '1.125rem' }}>
                {data.summary.roi_percent}%
              </div>
              <div style={{ color: '#64748b', fontSize: '0.6875rem', textTransform: 'uppercase' }}>ROI</div>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '1rem',
        color: '#f8fafc',
        fontSize: '1rem',
        fontWeight: 600,
      }}>
        <span style={{ fontSize: '1.25rem' }}>🧠</span>
        Agent Intelligence
      </div>

      {/* Quick Wins Section */}
      {quickWins.length > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding: '1rem',
          background: '#22c55e10',
          border: '1px solid #22c55e30',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            🔥 Quick Wins (Low Risk, High Savings)
          </div>
          {quickWins.map((qw, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0',
              borderBottom: i < quickWins.length - 1 ? '1px solid #1e293b' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#f8fafc', fontWeight: 500 }}>{qw.index_name}</span>
                <span style={{ color: '#22c55e', fontSize: '0.875rem' }}>+${(qw.savings / 1000).toFixed(0)}k</span>
              </div>
              <span style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.5rem',
                background: '#22c55e20',
                color: '#22c55e',
                borderRadius: '4px',
              }}>
                ✓ SAFE
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Top Recommendation */}
      {top && (
        <div style={{
          padding: '1rem',
          background: '#1e293b',
          borderRadius: '8px',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Top Recommendation
          </div>

          {/* Action + Index + Savings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span style={{
              padding: '0.25rem 0.75rem',
              background: `${actionColor}20`,
              color: actionColor,
              borderRadius: '4px',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}>
              {top.action}
            </span>
            <span style={{ color: '#f8fafc', fontWeight: 500 }}>
              {top.index_name}
            </span>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>
              → saves ${(top.savings / 1000).toFixed(0)}k/year
            </span>
          </div>

          {/* Why Now? (Trend with delta) */}
          <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
            {top.trend === 'declining_usage' && (
              <span style={{ color: '#f59e0b' }}>
                📉 Usage down {Math.abs(top.trend_percent)}% — safe to reduce
              </span>
            )}
            {top.trend === 'stable' && (
              <span style={{ color: '#94a3b8' }}>
                → Stable usage pattern
              </span>
            )}
            {top.trend === 'increasing' && (
              <span style={{ color: '#3b82f6' }}>
                📈 Usage up {top.trend_percent}% — consider archiving instead
              </span>
            )}
          </div>

          {/* Blast Radius */}
          <div style={{ marginBottom: '0.75rem' }}>
            {top.safe_to_delete ? (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.375rem 0.75rem',
                background: '#22c55e15',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                color: '#22c55e',
              }}>
                ✓ SAFE TO DELETE (no dashboards, no alerts)
              </div>
            ) : (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.375rem 0.75rem',
                background: '#f59e0b15',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                color: '#f59e0b',
              }}>
                ⚠️ HIGH IMPACT
                {top.blast_radius.dashboards > 0 && ` (${top.blast_radius.dashboards} dashboards)`}
              </div>
            )}
          </div>

          {/* Why */}
          <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b' }}>Why:</span> {top.reason}
          </div>

          {/* Confidence Breakdown */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ color: '#64748b' }}>Confidence: <span style={{ color: top.confidence > 0.8 ? '#22c55e' : top.confidence > 0.6 ? '#f59e0b' : '#ef4444' }}>{top.confidence_level}</span></span>
              <span style={{ color: '#22c55e' }}>{Math.round(top.confidence * 100)}%</span>
            </div>
            <div style={{ width: '100%', background: '#0a0a0a', borderRadius: '3px', height: 6, overflow: 'hidden', marginBottom: '0.75rem' }}>
              <div style={{
                width: `${top.confidence * 100}%`,
                background: top.confidence > 0.8 ? '#22c55e' : top.confidence > 0.6 ? '#f59e0b' : '#ef4444',
                height: '100%',
                borderRadius: '3px',
              }} />
            </div>
            {/* Signals */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {top.confidence_signals?.map((signal, i) => (
                <div key={i} style={{
                  padding: '0.25rem 0.5rem',
                  background: signal.status === 'HIGH' ? '#22c55e15' : signal.status === 'NONE' ? '#3b82f615' : '#f59e0b15',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                }}>
                  <span style={{ color: signal.status === 'HIGH' ? '#22c55e' : signal.status === 'NONE' ? '#3b82f6' : '#f59e0b' }}>
                    {signal.status === 'HIGH' ? '●' : signal.status === 'NONE' ? '○' : '◐'}
                  </span>
                  <span style={{ color: '#94a3b8', marginLeft: '0.25rem' }}>{signal.name}: {signal.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Badge */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Risk Score:</span>
            <span style={{
              fontSize: '0.75rem',
              padding: '0.125rem 0.5rem',
              background: top.risk > 80 ? '#ef444420' : top.risk > 50 ? '#f59e0b20' : '#22c55e20',
              color: top.risk > 80 ? '#ef4444' : top.risk > 50 ? '#f59e0b' : '#22c55e',
              borderRadius: '4px',
            }}>
              {top.risk}/100
            </span>
          </div>
        </div>
      )}

      {/* Action Status */}
      {actionStatus && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.5rem 0.75rem',
          background: actionStatus.status.includes('⚠️') ? '#ef444415' : '#22c55e15',
          color: actionStatus.status.includes('⚠️') ? '#ef4444' : '#22c55e',
          borderRadius: '6px',
          fontSize: '0.875rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{actionStatus.status}</span>
          {actionStatus.action === 'APPROVED' && top && (
            <button
              onClick={() => handleAction(top.index_name, top.action, 'REVERTED')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '0.75rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {!actionStatus?.status.includes('✓') && top && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleAction(top.index_name, top.action, 'APPROVED')}
            disabled={loading}
            style={{
              flex: 1,
              minWidth: '140px',
              padding: '0.625rem 1rem',
              background: loading ? '#1e293b' : '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Processing...' : `Approve ${top.action}`}
          </button>
          <button
            onClick={() => handleAction(top.index_name, top.action, 'IGNORED')}
            disabled={loading}
            style={{
              flex: 1,
              minWidth: '140px',
              padding: '0.625rem 1rem',
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontWeight: 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            Investigate Further
          </button>
        </div>
      )}

      {/* Other Recommendations */}
      {data?.top_decisions && data.top_decisions.length > 1 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
            Other Recommendations ({data.top_decisions.length - 1})
          </div>
          {data.top_decisions.slice(1).map((d, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem',
              background: '#1e293b',
              borderRadius: '6px',
              marginTop: '0.5rem',
              fontSize: '0.875rem',
            }}>
              <span style={{ color: actionColor, fontWeight: 600, fontSize: '0.75rem' }}>{d.action}</span>
              <span style={{ color: '#f8fafc', flex: 1 }}>{d.index_name}</span>
              <span style={{ color: '#22c55e', fontSize: '0.75rem' }}>+${(d.savings / 1000).toFixed(0)}k</span>
              {d.safe_to_delete && (
                <span style={{ fontSize: '0.625rem', color: '#22c55e' }}>✓ SAFE</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Total Savings */}
      {data?.total_potential_savings && data.total_potential_savings > 0 && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: '#22c55e15',
          borderRadius: '6px',
          textAlign: 'center',
          color: '#22c55e',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}>
          Total Potential Savings: ${(data.total_potential_savings / 1000).toFixed(0)}k/year
        </div>
      )}
    </div>
  );
}
