'use client';
import { apiFetch } from '../lib/api-client';

import { useState, useEffect } from 'react';

interface ModelHealthScore {
  snapshotDate: string;
  totalReviews30d: number;
  totalRejections30d: number;
  modelTrustScore: number;
  systemHealthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  alertMessage?: string;
  staleApprovalsCount: number;
  expiredApprovalsCount: number;
  fingerprintChangesDetected: number;
}

export function ModelHealthMonitor() {
  const [health, setHealth] = useState<ModelHealthScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModelHealth();
  }, []);

  const fetchModelHealth = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/model-health');
      const data = await res.json();

      if (res.ok && data.data) {
        setHealth(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch model health');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch model health');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: '#666' }}>Loading model health...</div>;
  }

  if (!health) {
    return (
      <div style={{ padding: '20px', color: '#666', textAlign: 'center' }}>
        <p>Model health data unavailable</p>
        <button
          onClick={fetchModelHealth}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const rejectionRate = health.totalReviews30d > 0
    ? (health.totalRejections30d / health.totalReviews30d * 100).toFixed(1)
    : '0.0';

  const getHealthColor = () => {
    switch (health.systemHealthStatus) {
      case 'CRITICAL':
        return '#E74C3C';
      case 'DEGRADED':
        return '#F39C12';
      default:
        return '#27AE60';
    }
  };

  const getHealthEmoji = () => {
    switch (health.systemHealthStatus) {
      case 'CRITICAL':
        return '🚨';
      case 'DEGRADED':
        return '⚠️';
      default:
        return '✅';
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '20px', color: '#333' }}>
        {getHealthEmoji()} Model Health Monitor
      </h2>

      {/* System Health Alert */}
      {health.alertMessage && (
        <div
          style={{
            padding: '16px',
            marginBottom: '20px',
            backgroundColor: health.systemHealthStatus === 'CRITICAL' ? '#FADBD8' : '#FCF3CF',
            border: `2px solid ${getHealthColor()}`,
            borderRadius: '8px',
            color: '#333',
            fontSize: '14px'
          }}
        >
          <strong>{health.alertMessage}</strong>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        {/* Model Trust Score */}
        <div
          style={{
            padding: '16px',
            backgroundColor: '#FAFAFA',
            borderRadius: '8px',
            border: `2px solid ${getHealthColor()}`,
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', textTransform: 'uppercase' }}>
            Model Trust Score
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: getHealthColor() }}>
            {(health.modelTrustScore * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            Disagreement Rate: {rejectionRate}%
          </div>
        </div>

        {/* Reviews in Past 30 Days */}
        <div
          style={{
            padding: '16px',
            backgroundColor: '#FAFAFA',
            borderRadius: '8px',
            border: '2px solid #3498DB',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', textTransform: 'uppercase' }}>
            Reviews (30 Days)
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#3498DB' }}>
            {health.totalReviews30d}
          </div>
          <div style={{ fontSize: '12px', color: '#E74C3C', marginTop: '8px' }}>
            Rejections: {health.totalRejections30d}
          </div>
        </div>

        {/* Governance Hygiene */}
        <div
          style={{
            padding: '16px',
            backgroundColor: '#FAFAFA',
            borderRadius: '8px',
            border: '2px solid #F39C12',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', textTransform: 'uppercase' }}>
            Approvals Needing Review
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#F39C12' }}>
            {health.staleApprovalsCount + health.expiredApprovalsCount}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
            Stale: {health.staleApprovalsCount} | Expired: {health.expiredApprovalsCount}
          </div>
        </div>
      </div>

      {/* System Status */}
      <div
        style={{
          padding: '16px',
          backgroundColor: '#FAFAFA',
          borderRadius: '8px',
          border: '1px solid #e0e0e0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: getHealthColor(),
            }}
          />
          <div>
            <strong style={{ color: '#333', fontSize: '14px' }}>System Status</strong>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {health.systemHealthStatus === 'HEALTHY'
                ? 'All governance systems nominal'
                : health.systemHealthStatus === 'DEGRADED'
                ? 'Review patterns indicate model drift - consider prompt recalibration'
                : 'CRITICAL: High rejection rate - all pending workers in high-scrutiny mode'}
            </div>
          </div>
        </div>
      </div>

      {/* Refresh Button */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <button
          onClick={fetchModelHealth}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Refresh Health Status
        </button>
      </div>
    </div>
  );
}
