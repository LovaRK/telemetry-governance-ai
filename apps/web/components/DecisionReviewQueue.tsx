'use client';

import { useState, useEffect } from 'react';
import { useUser } from '../lib/user-context';

interface DeterministicSignals {
  daily_avg_gb_change_pct: number;
  cost_per_year_usd: number;
  retention_days: number;
  days_since_last_event: number;
  utilization_pct: number;
  search_count_30d: number;
  volume_bucket: string;
  utilization_bucket: string;
  freshness_bucket: string;
}

interface CognitiveSignals {
  model: string;
  model_version: string;
  prompt_hash: string;
  temperature: number;
  confidence_score: number;
  reasoning: string;
  inference_tokens: number;
  latency_ms: number;
}

interface Decision {
  id: string;
  snapshotId: string;
  indexName: string;
  sourcetype?: string;
  deterministicSignals: DeterministicSignals;
  cognitiveSignals?: CognitiveSignals;
  decisionStatus: string;
  reviewedBy?: string;
  reviewedAt?: string;
  appliedAt?: string;
  dismissalReason?: string;
  factId?: string;
  calibrationVector?: number;
  calibratedConfidence?: number;
  effectiveConfidence?: number;
  reviewStatus?: string;
  isCapped?: boolean;
  processingTier?: 'TIER_A' | 'TIER_B';
  approvalStatus?: 'FRESH' | 'STALE' | 'EXPIRED';
  provenanceLabel?: string;
  provenanceColor?: string;
  daysSinceReview?: number;
  decayReason?: string;
}

export function DecisionReviewQueue() {
  const { userName } = useUser();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingDecisions();
  }, []);

  const fetchPendingDecisions = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/decision-lineage?limit=100');
      const result = await res.json();

      if (result.mode === 'DEMO_MODE') {
        setError('Database not available');
        setDecisions([]);
        return;
      }

      setDecisions(result.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch decisions');
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string, factId?: string) => {
    try {
      setProcessingId(id);
      const res = await fetch(`/api/decision-lineage/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          reviewedBy: userName,
          factId: factId || id
        })
      });

      if (!res.ok) throw new Error('Failed to approve decision');

      // Refresh list
      await fetchPendingDecisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string, reason: string, factId?: string) => {
    try {
      setProcessingId(id);
      const res = await fetch(`/api/decision-lineage/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          reviewedBy: userName,
          dismissalReason: reason,
          factId: factId || id
        })
      });

      if (!res.ok) throw new Error('Failed to reject decision');

      // Refresh list
      await fetchPendingDecisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: '#666' }}>Loading decisions...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: '#d32f2f', backgroundColor: '#ffebee', borderRadius: '8px' }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div style={{ padding: '20px', color: '#666', textAlign: 'center' }}>
        <p>No decisions awaiting review</p>
        <button
          onClick={fetchPendingDecisions}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '20px', color: '#333' }}>
        Decision Review Queue ({decisions.length} pending)
      </h2>

      <div style={{ display: 'grid', gap: '16px' }}>
        {decisions.map((decision) => (
          <div
            key={decision.id}
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: '#fafafa'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px',
                backgroundColor: '#f5f5f5',
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer'
              }}
              onClick={() => setExpandedId(expandedId === decision.id ? null : decision.id)}
            >
              <div>
                <strong style={{ fontSize: '16px', color: '#333' }}>
                  {decision.indexName}
                </strong>
                {decision.sourcetype && (
                  <span style={{ marginLeft: '12px', color: '#666', fontSize: '14px' }}>
                    / {decision.sourcetype}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span
                  style={{
                    padding: '4px 8px',
                    backgroundColor: decision.decisionStatus === 'PROPOSED' ? '#fff3e0' : '#e3f2fd',
                    color: decision.decisionStatus === 'PROPOSED' ? '#e65100' : '#01579b',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  {decision.decisionStatus}
                </span>
                <span style={{ fontSize: '20px', color: '#666' }}>
                  {expandedId === decision.id ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {/* Expanded content */}
            {expandedId === decision.id && (
              <div style={{ padding: '16px', backgroundColor: 'white' }}>
                {/* Deterministic Signals */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>
                      📊 Deterministic Signals
                    </h4>
                    <span style={{
                      fontSize: '11px',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: '500'
                    }}>
                      Direct Splunk Metrics
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '12px',
                      fontSize: '13px',
                      color: '#666'
                    }}
                  >
                    <div>
                      <strong>Daily GB Change:</strong> {decision.deterministicSignals.daily_avg_gb_change_pct}%
                    </div>
                    <div>
                      <strong>Annual Cost:</strong> ${decision.deterministicSignals.cost_per_year_usd}
                    </div>
                    <div>
                      <strong>Retention:</strong> {decision.deterministicSignals.retention_days}d
                    </div>
                    <div>
                      <strong>Days Since Event:</strong> {decision.deterministicSignals.days_since_last_event}
                    </div>
                    <div>
                      <strong>Utilization:</strong> {decision.deterministicSignals.utilization_pct}%
                    </div>
                    <div>
                      <strong>30d Searches:</strong> {decision.deterministicSignals.search_count_30d}
                    </div>
                    <div>
                      <strong>Volume Bucket:</strong> {decision.deterministicSignals.volume_bucket}
                    </div>
                    <div>
                      <strong>Utilization Bucket:</strong> {decision.deterministicSignals.utilization_bucket}
                    </div>
                    <div>
                      <strong>Freshness Bucket:</strong> {decision.deterministicSignals.freshness_bucket}
                    </div>
                  </div>
                </div>

                {/* Cognitive Signals */}
                {decision.cognitiveSignals && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>
                        🤖 Cognitive Signals
                      </h4>
                      <span style={{
                        fontSize: '11px',
                        backgroundColor: '#2196f3',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: '500'
                      }}>
                        AI-Enhanced Insight
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#666' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Confidence Score:</strong> {decision.cognitiveSignals.confidence_score.toFixed(2)} / 1.0
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Model:</strong> {decision.cognitiveSignals.model_version}
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <strong>Reasoning:</strong>
                        <p style={{ margin: '4px 0 0 0', padding: '8px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                          {decision.cognitiveSignals.reasoning}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Human Calibration Status with Trust Decay */}
                <div style={{ marginBottom: '16px', backgroundColor: decision.provenanceColor ? `${decision.provenanceColor}20` : '#f5f5f5', padding: '12px', borderRadius: '4px', border: `1px solid ${decision.provenanceColor || '#e0e0e0'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>
                      ⚖️ Governance Lifecycle
                    </h4>
                    <span style={{
                      fontSize: '11px',
                      backgroundColor: decision.processingTier === 'TIER_A' ? '#4caf50' : '#ff9800',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: '500'
                    }}>
                      {decision.processingTier || 'TIER_A'}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      backgroundColor: decision.provenanceColor || '#8E44AD',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: '500'
                    }}>
                      {decision.provenanceLabel || '🤖 AI'}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Review Status:</strong> {decision.reviewStatus || 'UNREVIEWED'} {decision.approvalStatus === 'EXPIRED' && <span style={{ color: '#D35400' }}>⏳ (Expired)</span>}
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Calibration Vector (H):</strong> {decision.calibrationVector?.toFixed(2) || '0.50'}
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Raw Stability:</strong> {decision.cognitiveSignals?.confidence_score?.toFixed(2) || '0.00'}
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Calibrated Confidence:</strong> {decision.calibratedConfidence?.toFixed(2) || '0.00'}
                      {decision.isCapped && <span style={{ marginLeft: '8px', color: '#ff6f00' }}>⚠️ Capped at 50%</span>}
                    </div>
                    <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'white', borderRadius: '4px', borderLeft: `3px solid ${decision.provenanceColor || '#8E44AD'}` }}>
                      <strong>Effective Confidence (with decay):</strong> {decision.effectiveConfidence?.toFixed(2) || '0.00'}
                      {decision.daysSinceReview !== undefined && (
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                          Days since review: {decision.daysSinceReview}d
                          {decision.decayReason && (
                            <p style={{ margin: '4px 0', fontStyle: 'italic' }}>{decision.decayReason}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '20px', borderTop: '1px solid #e0e0e0', paddingTop: '16px' }}>
                  <button
                    onClick={() => handleApprove(decision.id, decision.factId)}
                    disabled={processingId === decision.id}
                    style={{
                      flex: 1,
                      padding: '10px',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: processingId === decision.id ? 'wait' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    {processingId === decision.id ? 'Processing...' : '✓ Approve & Calibrate'}
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt('Rejection reason:');
                      if (reason) handleReject(decision.id, reason, decision.factId);
                    }}
                    disabled={processingId === decision.id}
                    style={{
                      flex: 1,
                      padding: '10px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: processingId === decision.id ? 'wait' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    {processingId === decision.id ? 'Processing...' : '✗ Reject & Blacklist'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
