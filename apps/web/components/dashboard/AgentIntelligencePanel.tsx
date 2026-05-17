'use client';

import React, { useState } from 'react';
import { SnapshotRow, ExecutiveKPIs } from '../../lib/types';
import ReasoningDrawer, { ReasoningDrawerProps } from '../shared/ReasoningDrawer';
import SectionExplainer from '../shared/SectionExplainer';

function fmt$(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  if (v >= 1) return `$${v.toFixed(0)}`;
  if (v > 0) return `$${v.toFixed(2)}`;
  return '$0';
}

interface Props {
  snapshots: SnapshotRow[];
  kpis: ExecutiveKPIs;
  hasAgentDecisions?: boolean;
}

type DrawerData = Omit<ReasoningDrawerProps, 'isOpen' | 'onClose'>;

export default function AgentIntelligencePanel({ snapshots, kpis, hasAgentDecisions = false }: Props) {
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const s3Candidates = snapshots.filter((s) => s.isS3Candidate);
  const detectionGaps = snapshots.filter((s) => s.detectionGap);
  const quickWins = snapshots.filter((s) => s.isQuickWin);
  const topByRisk = [...snapshots].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5);

  return (
    <>
    <ReasoningDrawer isOpen={!!drawer} onClose={() => setDrawer(null)} {...(drawer || { title: '' })} />
    <SectionExplainer
      title="How was this section calculated?"
      summary="Agent Intelligence highlights the highest-risk indexes, security detection gaps, and immediate optimization opportunities. Click any row to see the LLM's reasoning for its risk assessment."
      dataInputs={['risk_score', 'detection_gap', 'is_quick_win', 'is_s3_candidate', 'confidence']}
      decisionLogic="Risk Score: weighted combination of detection gaps (0–100), low utilization (0–100), high cost-to-value ratio, and data staleness. Detection gaps indicate missing security coverage. S3/Archive candidates scored on cost savings potential."
    />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>

      <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
          🔴 Top Risk Indexes
        </div>
        {!hasAgentDecisions
          ? <div style={{ color: '#475569', fontSize: '0.8rem' }}>⏳ Awaiting LLM decisions</div>
          : topByRisk.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.8rem' }}>No data</div>
            : topByRisk.map((s) => (
              <div
                key={s.indexName}
                onClick={() => setDrawer({ title: s.indexName, value: `Risk: ${s.riskScore.toFixed(0)}`, tier: s.tier, action: s.action, confidence: s.compositeScore, llmReasoning: s.reasoning, howCalculated: `Risk Score is calculated by the LLM based on: detection gaps, low query utilization, high cost vs value, and proximity to stale data.`, evidence: [s.recommendation || s.reasoning].filter(Boolean), rawData: { riskScore: s.riskScore, utilizationScore: s.utilizationScore, detectionScore: s.detectionScore, qualityScore: s.qualityScore, costPerYear: s.costPerYear } })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', padding: '0.2rem 0.4rem', borderRadius: 4 }}
              >
                <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{s.indexName}</span>
                <span style={{ color: s.riskScore > 70 ? '#ef4444' : s.riskScore > 40 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>
                  {s.riskScore.toFixed(0)} ↗
                </span>
              </div>
            ))
        }
      </div>

      <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
          ⚠ Detection Gaps ({detectionGaps.length})
        </div>
        {detectionGaps.length === 0
          ? <div style={{ color: '#22c55e', fontSize: '0.8rem' }}>✓ No critical detection gaps identified</div>
          : detectionGaps.slice(0, 5).map((s) => (
            <div
              key={s.indexName}
              onClick={() => setDrawer({ title: s.indexName, tier: s.tier, action: s.action, llmReasoning: s.reasoning, howCalculated: `This index has detectionGap=true: the LLM found no active security alerts or MITRE ATT&CK coverage mapped to it, despite having data. This means threats from this data source would go undetected.`, evidence: [s.recommendation || s.reasoning].filter(Boolean), rawData: { detectionScore: s.detectionScore, utilizationScore: s.utilizationScore, riskScore: s.riskScore } })}
              style={{ marginBottom: '0.625rem', paddingBottom: '0.625rem', borderBottom: '1px solid #1e293b', cursor: 'pointer' }}
            >
              <div style={{ color: '#f8fafc', fontSize: '0.8rem', fontWeight: 600 }}>{s.indexName} ↗</div>
              <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                {s.reasoning?.slice(0, 80)}{(s.reasoning?.length || 0) > 80 ? '…' : ''}
              </div>
            </div>
          ))
        }
      </div>

      <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
          💡 Opportunities
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ padding: '0.75rem', background: '#1e293b', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>⚡ Quick Wins</span>
              <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.875rem' }}>{quickWins.length}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.2rem' }}>
              {fmt$(quickWins.reduce((acc, q) => acc + (q.estimatedSavings || 0), 0))} potential
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: '#1e293b', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>☁ S3 Archive Candidates</span>
              <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: '0.875rem' }}>{s3Candidates.length}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.2rem' }}>
              {fmt$(s3Candidates.reduce((acc, q) => acc + (q.estimatedSavings || 0), 0))} potential
            </div>
          </div>
          <div style={{ padding: '0.75rem', background: '#1e293b', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Low-Value Spend</span>
              <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.875rem' }}>
                {fmt$(kpis.licenseSpendLowValue)}
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.2rem' }}>
              of {fmt$(kpis.totalLicenseSpend)} total spend
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
