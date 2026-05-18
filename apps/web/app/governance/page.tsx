'use client';

import { useState } from 'react';
import { DriftMonitor } from '../components/DriftMonitor';
import { ReanalysisQueueStatus } from '../components/ReanalysisQueueStatus';
import { DecisionReviewQueue } from '../../components/DecisionReviewQueue';

export default function GovernancePage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'drift' | 'queue' | 'review'>('overview');

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 16px',
    backgroundColor: isActive ? '#1976d2' : '#f5f5f5',
    color: isActive ? 'white' : '#666',
    border: 'none',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    fontWeight: isActive ? 'bold' : 'normal',
    fontSize: '13px',
    transition: 'all 0.2s',
  });

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ marginBottom: '8px', color: '#2c3e50', fontSize: '28px' }}>
          🔍 Governance & Transparency Dashboard
        </h1>
        <p style={{
          color: '#7f8c8d',
          fontSize: '13px',
          lineHeight: '1.6',
          maxWidth: '800px',
        }}>
          Real-time visibility into decision governance, drift detection, and reanalysis progress.
          This dashboard exposes the internal mechanics of the trust engine without pretty-printing
          or executive storytelling. Every number here represents a raw, verifiable system state.
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '24px',
        borderBottom: '2px solid #e0e0e0',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={tabStyle(activeTab === 'overview')}
        >
          📊 Overview
        </button>
        <button
          onClick={() => setActiveTab('drift')}
          style={tabStyle(activeTab === 'drift')}
        >
          🌊 Drift Monitor
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          style={tabStyle(activeTab === 'queue')}
        >
          ⚙️ Reanalysis Queue
        </button>
        <button
          onClick={() => setActiveTab('review')}
          style={tabStyle(activeTab === 'review')}
        >
          ✓ Decision Review
        </button>
      </div>

      {/* Content */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '0 4px 4px 4px',
        border: '1px solid #e0e0e0',
        padding: '24px',
      }}>
        {activeTab === 'overview' && (
          <div>
            <h2 style={{ marginBottom: '24px', color: '#2c3e50', fontSize: '18px' }}>
              System Status Overview
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
              {/* Queue Status */}
              <div style={{
                backgroundColor: '#f9f9f9',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '16px',
              }}>
                <h3 style={{ marginBottom: '16px', color: '#2c3e50', fontSize: '14px' }}>
                  Reanalysis Pipeline
                </h3>
                <ReanalysisQueueStatus />
              </div>

              {/* Governance Info */}
              <div style={{
                backgroundColor: '#f9f9f9',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '16px',
              }}>
                <h3 style={{ marginBottom: '16px', color: '#2c3e50', fontSize: '14px' }}>
                  Trust Layer Status
                </h3>
                <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
                  <div style={{ marginBottom: '12px' }}>
                    <strong>Confidence Decay:</strong>
                    <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
                      ✓ Active (30-day half-life)
                      <br />
                      ✓ Approval expiry: 90 days
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <strong>Seasonality Baselines:</strong>
                    <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
                      ✓ 9 time classes tracked
                      <br />
                      ✓ Weekly/monthly/quarterly detection
                    </div>
                  </div>
                  <div>
                    <strong>Risk-Weighted Sampling:</strong>
                    <div style={{ fontSize: '11px', color: '#7f8c8d', marginTop: '4px' }}>
                      ✓ Weekly ground truth audits
                      <br />
                      ✓ Targeting stable hallucinations
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* How to Use */}
            <div style={{
              backgroundColor: '#ecf0f1',
              border: '1px solid #bdc3c7',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '12px',
              color: '#2c3e50',
              lineHeight: '1.6',
            }}>
              <strong>📖 How to Use This Dashboard</strong>
              <div style={{ marginTop: '8px' }}>
                <div>
                  • <strong>Drift Monitor tab:</strong> See all indexes with active drift, grouped by severity. Click any row to inspect the complete trust state.
                </div>
                <div style={{ marginTop: '4px' }}>
                  • <strong>Reanalysis Queue tab:</strong> Monitor AI processing jobs in real-time. Queue fills when drift is detected or human reviews trigger re-analysis.
                </div>
                <div style={{ marginTop: '4px' }}>
                  • <strong>Decision Review tab:</strong> Approve, reject, or inspect decisions pending human calibration. Your reviews feed the human calibration formula.
                </div>
                <div style={{ marginTop: '4px' }}>
                  • <strong>Trust Inspection Modal:</strong> Available from any decision row. Shows confidence decomposition, drift penalties, and why the system arrived at its conclusion.
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'drift' && (
          <div>
            <h2 style={{ marginBottom: '24px', color: '#2c3e50', fontSize: '18px' }}>
              Drift Detection Monitor
            </h2>
            <p style={{ color: '#7f8c8d', fontSize: '12px', marginBottom: '16px', lineHeight: '1.6' }}>
              All detected drift events across your monitored indexes. Each row shows the drift classification,
              severity score, human-readable reason, and whether it's queued for reanalysis. Click any row to
              inspect the full governance state including all confidence multipliers.
            </p>
            <DriftMonitor limit={100} />
          </div>
        )}

        {activeTab === 'queue' && (
          <div>
            <h2 style={{ marginBottom: '24px', color: '#2c3e50', fontSize: '18px' }}>
              Reanalysis Queue Status
            </h2>
            <p style={{ color: '#7f8c8d', fontSize: '12px', marginBottom: '16px', lineHeight: '1.6' }}>
              Real-time view of the background reanalysis job queue. Shows queue depth by priority tier,
              estimated completion time, and processing capacity. The system respects hardware constraints
              and adapts processing speed based on thermal state and queue load.
            </p>
            <ReanalysisQueueStatus />
          </div>
        )}

        {activeTab === 'review' && (
          <div>
            <h2 style={{ marginBottom: '24px', color: '#2c3e50', fontSize: '18px' }}>
              Decision Review Queue
            </h2>
            <p style={{ color: '#7f8c8d', fontSize: '12px', marginBottom: '16px', lineHeight: '1.6' }}>
              Decisions awaiting your human calibration. Click "Inspect Trust" to see the full governance
              state before approving or rejecting. Your feedback trains the calibration formula and feeds
              the model health ledger.
            </p>
            <DecisionReviewQueue />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: '32px',
        padding: '16px',
        backgroundColor: '#f9f9f9',
        borderRadius: '8px',
        fontSize: '11px',
        color: '#7f8c8d',
        lineHeight: '1.6',
      }}>
        <strong>💡 Important Notes</strong>
        <div style={{ marginTop: '8px' }}>
          This is a <em>diagnostic</em> dashboard, not an executive summary. Every value you see here
          is a raw system measurement. No averaging, no smoothing, no narratives. This is intentional.
          The goal is to expose the machinery so you can verify the system is working correctly before
          trusting it with higher-stakes decisions.
        </div>
      </div>
    </div>
  );
}
