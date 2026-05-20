'use client';

import { useEffect, useState } from 'react';

interface TrustStatusData {
  confidenceDecay: {
    active: boolean;
    decayHalfLifeDays: number;
    approvalExpiryDays: number;
  };
  seasonalityBaselines: {
    timeClassesTracked: number;
    detectionFrequencies: string[];
  };
  riskWeightedSampling: {
    auditFrequency: string;
    targetingStrategy: string;
  };
  currentHealth: {
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    modelTrustScore: number;
    totalReviews30d: number;
    totalRejections30d: number;
    staleApprovalsCount: number;
    expiredApprovalsCount: number;
    alertMessage: string | null;
    asOf: string;
  };
}

export default function TrustLayerStatus() {
  const [data, setData] = useState<TrustStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrustStatus = async () => {
      try {
        const response = await fetch('/api/governance/trust-status', {
          headers: {
            'Authorization': `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('access_token') : ''}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch trust status: ${response.statusText}`);
        }

        const result = await response.json();
        setData(result.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Trust status fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTrustStatus();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#7f8c8d' }}>
        Loading trust status...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '16px', color: '#e74c3c' }}>
        Error loading trust status: {error}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
      <div style={{ marginBottom: '12px' }}>
        <strong>Confidence Decay:</strong>
        <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
          ✓ Active ({data.confidenceDecay.decayHalfLifeDays}-day half-life)
          <br />
          ✓ Approval expiry: {data.confidenceDecay.approvalExpiryDays} days
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <strong>Seasonality Baselines:</strong>
        <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
          ✓ {data.seasonalityBaselines.timeClassesTracked} time classes tracked
          <br />
          ✓ {data.seasonalityBaselines.detectionFrequencies.join('/')}/detection
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <strong>Risk-Weighted Sampling:</strong>
        <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
          ✓ {data.riskWeightedSampling.auditFrequency} ground truth audits
          <br />
          ✓ Targeting {data.riskWeightedSampling.targetingStrategy}
        </div>
      </div>
      {data.currentHealth.alertMessage && (
        <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#ffeaa7', borderRadius: '4px', fontSize: '10px' }}>
          ⚠️ {data.currentHealth.alertMessage}
        </div>
      )}
    </div>
  );
}
