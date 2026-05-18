'use client';

import { useEffect, useState } from 'react';

interface TrustInspectionPayload {
  index_name: string;
  governance_state: {
    internal_workflow: string;
    ui_trust_level: string;
    last_reviewed_by: string | null;
    last_reviewed_at: string | null;
    expires_at: string | null;
    is_stale: boolean;
  };
  drift_telemetry: {
    status: string;
    severity_score: number;
    human_readable_reason: string;
    evaluated_at: string;
  };
  confidence_decomposition: {
    base_confidence: number;
    stability_factor: number;
    drift_penalty: number;
    temporal_decay_factor: number;
    oscillation_multiplier: number;
    final_effective_confidence: number;
  };
  reanalysis_metadata: {
    is_queued: boolean;
    trigger_source: string | null;
    priority_tier: string | null;
    scheduled_at: string | null;
    estimated_completion_seconds: number | null;
  };
  sampling_audit: {
    was_sample_selected: boolean;
    sampling_method: string | null;
    trigger_metrics: {
      financial_weight: number;
      cache_reuse_depth: number;
      policy_sensitivity_multiplier: number;
    };
  };
}

const TRUST_LEVEL_COLORS: Record<string, string> = {
  'Trusted': '#27AE60',
  'Caution': '#D35400',
  'Unverified': '#3498DB',
  'Invalid': '#E74C3C',
  'Risky': '#8E44AD',
  'Frozen': '#95A5A6',
};

export function TrustInspectionPanel({ indexName }: { indexName: string }) {
  const [data, setData] = useState<TrustInspectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    governance: true,
    drift: true,
    confidence: true,
    reanalysis: false,
    sampling: false,
  });

  useEffect(() => {
    const fetch = async () => {
      try {
        const response = await window.fetch(`/api/trust-inspection?indexName=${encodeURIComponent(indexName)}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [indexName]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#7f8c8d', fontFamily: 'monospace' }}>
        Loading trust inspection...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px', color: '#e74c3c', fontFamily: 'monospace' }}>
        Error: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '16px', color: '#7f8c8d', fontFamily: 'monospace' }}>
        No data available
      </div>
    );
  }

  const trustLevelColor = TRUST_LEVEL_COLORS[data.governance_state.ui_trust_level] || '#95A5A6';

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', fontSize: '12px', backgroundColor: '#ecf0f1', borderRadius: '4px' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #bdc3c7' }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
          Trust Inspection: <span style={{ color: '#2c3e50' }}>{data.index_name}</span>
        </div>
        <div style={{
          display: 'inline-block',
          padding: '4px 8px',
          backgroundColor: trustLevelColor,
          color: 'white',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: 'bold',
        }}>
          {data.governance_state.ui_trust_level}
        </div>
      </div>

      {/* Governance State Section */}
      <div style={{ marginBottom: '12px' }}>
        <div
          onClick={() => toggleSection('governance')}
          style={{
            cursor: 'pointer',
            paddingBottom: '8px',
            marginBottom: '8px',
            borderBottom: '1px solid #bdc3c7',
            fontWeight: 'bold',
            color: '#2c3e50',
          }}
        >
          {expandedSections.governance ? '▼' : '▶'} GOVERNANCE STATE
        </div>
        {expandedSections.governance && (
          <div style={{ marginLeft: '12px', marginBottom: '12px', color: '#2c3e50' }}>
            <div>Workflow: <span style={{ color: '#8e44ad' }}>{data.governance_state.internal_workflow}</span></div>
            {data.governance_state.last_reviewed_by && (
              <>
                <div>Reviewed by: {data.governance_state.last_reviewed_by}</div>
                <div>Reviewed at: {new Date(data.governance_state.last_reviewed_at!).toLocaleString()}</div>
              </>
            )}
            {data.governance_state.expires_at && (
              <div>Expires: {new Date(data.governance_state.expires_at).toLocaleString()}</div>
            )}
            {data.governance_state.is_stale && (
              <div style={{ color: '#e74c3c', fontWeight: 'bold' }}>⚠️ STALE - Requires Re-Review</div>
            )}
          </div>
        )}
      </div>

      {/* Drift Telemetry Section */}
      <div style={{ marginBottom: '12px' }}>
        <div
          onClick={() => toggleSection('drift')}
          style={{
            cursor: 'pointer',
            paddingBottom: '8px',
            marginBottom: '8px',
            borderBottom: '1px solid #bdc3c7',
            fontWeight: 'bold',
            color: '#2c3e50',
          }}
        >
          {expandedSections.drift ? '▼' : '▶'} DRIFT TELEMETRY
        </div>
        {expandedSections.drift && (
          <div style={{ marginLeft: '12px', marginBottom: '12px', color: '#2c3e50' }}>
            <div>
              Status: <span style={{
                color: data.drift_telemetry.status === 'STABLE' ? '#27ae60' : '#e74c3c',
                fontWeight: 'bold',
              }}>
                {data.drift_telemetry.status}
              </span>
            </div>
            <div>Severity Score: {(data.drift_telemetry.severity_score * 100).toFixed(1)}%</div>
            <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff', borderLeft: '2px solid #3498db' }}>
              {data.drift_telemetry.human_readable_reason}
            </div>
            <div style={{ marginTop: '4px', fontSize: '10px', color: '#7f8c8d' }}>
              Evaluated: {new Date(data.drift_telemetry.evaluated_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Confidence Decomposition Section */}
      <div style={{ marginBottom: '12px' }}>
        <div
          onClick={() => toggleSection('confidence')}
          style={{
            cursor: 'pointer',
            paddingBottom: '8px',
            marginBottom: '8px',
            borderBottom: '1px solid #bdc3c7',
            fontWeight: 'bold',
            color: '#2c3e50',
          }}
        >
          {expandedSections.confidence ? '▼' : '▶'} CONFIDENCE DECOMPOSITION
        </div>
        {expandedSections.confidence && (
          <div style={{ marginLeft: '12px', marginBottom: '12px', color: '#2c3e50' }}>
            <div>
              <span style={{ display: 'inline-block', width: '180px' }}>Base Model Confidence:</span>
              <span>{(data.confidence_decomposition.base_confidence * 100).toFixed(1)}%</span>
            </div>
            <div style={{ marginLeft: '20px', marginTop: '4px', fontSize: '11px', color: '#7f8c8d' }}>
              × Stability Factor: {data.confidence_decomposition.stability_factor.toFixed(2)}
            </div>
            <div style={{ marginLeft: '20px', marginTop: '4px', fontSize: '11px', color: '#7f8c8d' }}>
              × Drift Penalty: {data.confidence_decomposition.drift_penalty.toFixed(2)}
            </div>
            <div style={{ marginLeft: '20px', marginTop: '4px', fontSize: '11px', color: '#7f8c8d' }}>
              × Temporal Decay: {data.confidence_decomposition.temporal_decay_factor.toFixed(2)}
            </div>
            <div style={{ marginLeft: '20px', marginTop: '4px', fontSize: '11px', color: '#7f8c8d' }}>
              × Oscillation Multiplier: {data.confidence_decomposition.oscillation_multiplier.toFixed(2)}
            </div>
            <div style={{
              marginTop: '8px',
              padding: '8px',
              backgroundColor: '#fff',
              borderLeft: '3px solid #27ae60',
              fontWeight: 'bold',
              fontSize: '13px',
            }}>
              Final Effective Confidence: {(data.confidence_decomposition.final_effective_confidence * 100).toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* Reanalysis Metadata Section */}
      {data.reanalysis_metadata.is_queued && (
        <div style={{ marginBottom: '12px' }}>
          <div
            onClick={() => toggleSection('reanalysis')}
            style={{
              cursor: 'pointer',
              paddingBottom: '8px',
              marginBottom: '8px',
              borderBottom: '1px solid #bdc3c7',
              fontWeight: 'bold',
              color: '#e74c3c',
            }}
          >
            {expandedSections.reanalysis ? '▼' : '▶'} ⚙️ REANALYSIS QUEUED
          </div>
          {expandedSections.reanalysis && (
            <div style={{ marginLeft: '12px', marginBottom: '12px', color: '#2c3e50' }}>
              <div>Reason: {data.reanalysis_metadata.trigger_source}</div>
              <div>Priority: <span style={{ fontWeight: 'bold' }}>{data.reanalysis_metadata.priority_tier}</span></div>
              <div>Scheduled: {data.reanalysis_metadata.scheduled_at && new Date(data.reanalysis_metadata.scheduled_at).toLocaleString()}</div>
              {data.reanalysis_metadata.estimated_completion_seconds && (
                <div>Est. Completion: ~{Math.round(data.reanalysis_metadata.estimated_completion_seconds / 60)}m</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sampling Audit Section */}
      {data.sampling_audit.was_sample_selected && (
        <div style={{ marginBottom: '12px' }}>
          <div
            onClick={() => toggleSection('sampling')}
            style={{
              cursor: 'pointer',
              paddingBottom: '8px',
              marginBottom: '8px',
              borderBottom: '1px solid #bdc3c7',
              fontWeight: 'bold',
              color: '#2c3e50',
            }}
          >
            {expandedSections.sampling ? '▼' : '▶'} 📋 AUDIT SELECTION ANALYSIS
          </div>
          {expandedSections.sampling && (
            <div style={{ marginLeft: '12px', marginBottom: '12px', color: '#2c3e50', fontSize: '11px' }}>
              <div style={{ marginBottom: '8px' }}>
                This index has been proactively selected for manual calibration based on Risk-Weighted Sampling:
              </div>
              {data.sampling_audit.trigger_metrics.financial_weight > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  ├─ [CRITERIA] High Asset Value: ${(data.sampling_audit.trigger_metrics.financial_weight * 1000).toFixed(2)}/month estimated waste
                </div>
              )}
              {data.sampling_audit.trigger_metrics.cache_reuse_depth > 5 && (
                <div style={{ marginBottom: '4px' }}>
                  ├─ [CRITERIA] Extreme Cache Depth: Decision inherited {data.sampling_audit.trigger_metrics.cache_reuse_depth} consecutive times
                </div>
              )}
              {data.sampling_audit.trigger_metrics.policy_sensitivity_multiplier > 1.0 && (
                <div>
                  └─ [CRITERIA] Compliance Scope: Index matches policy-sensitive identifier parameters
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
