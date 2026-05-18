'use client';

import React from 'react';
import { SnapshotRow, ExecutiveKPIs } from '../../lib/types';

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

export default function AgentIntelligencePanel({ snapshots, kpis, hasAgentDecisions = false }: Props) {
  const s3Candidates = snapshots.filter((s) => s.isS3Candidate);
  const detectionGaps = snapshots.filter((s) => s.detectionGap);
  const quickWins = snapshots.filter((s) => s.isQuickWin);
  const topByRisk = [...snapshots].sort((a, b) => Number(b.riskScore) - Number(a.riskScore)).slice(0, 5);

  return (
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
              <div key={s.indexName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{s.indexName}</span>
                <span style={{ color: Number(s.riskScore) > 70 ? '#ef4444' : Number(s.riskScore) > 40 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>
                  {Number(s.riskScore).toFixed(0)}
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
            <div key={s.indexName} style={{ marginBottom: '0.625rem', paddingBottom: '0.625rem', borderBottom: '1px solid #1e293b' }}>
              <div style={{ color: '#f8fafc', fontSize: '0.8rem', fontWeight: 600 }}>{s.indexName}</div>
              {s.recommendation && (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem', fontStyle: 'italic' }}>
                  {s.recommendation}
                </div>
              )}
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
  );
}
