'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api-client';
import KPITrendChart from '../../../components/KPITrendChart';

interface IndexDetail {
  indexName: string;
  sourcetype?: string;
  tier?: string;
  action?: string;
  dailyAvgGb?: number;
  costPerYear?: number;
  compositeScore?: number;
  utilizationScore?: number;
  detectionScore?: number;
  qualityScore?: number;
  estimatedSavings?: number;
  confidence?: number;
  reasoning?: string;
  recommendation?: string;
  isQuickWin?: boolean;
  isS3Candidate?: boolean;
  detectionGap?: boolean;
  governanceStatus?: string;
  governanceNote?: string;
  governanceActor?: string;
  governanceUpdatedAt?: string;
}

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e', OPTIMIZE: '#f59e0b', ARCHIVE: '#3b82f6', ELIMINATE: '#ef4444', INVESTIGATE: '#8b5cf6',
};
const TIER_COLORS: Record<string, string> = {
  'Critical': '#ef4444', 'Important': '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
};

function fmt$(v?: number): string {
  const n = Number(v);
  if (!isFinite(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  if (n > 0) return `$${n.toFixed(2)}`;
  return '$0';
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color }}>{pct.toFixed(0)}</span>
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

export default function IndexDetailPage() {
  const params = useParams();
  const indexName = decodeURIComponent(params.name as string);

  const [detail, setDetail] = useState<IndexDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch('/api/executive-summary');
        if (!res.ok) { setError('Failed to load data'); return; }
        const data = await res.json();

        // Find this index in snapshots
        const snap = (data.snapshots || []).find((s: any) =>
          s.indexName === indexName || s.index_name === indexName
        );
        const dec = (data.decisions || []).find((d: any) =>
          d.indexName === indexName || d.index_name === indexName
        );

        if (!snap && !dec) { setError(`Index "${indexName}" not found`); return; }

        setDetail({
          indexName,
          sourcetype: snap?.sourcetype || dec?.sourcetype,
          tier: snap?.tier || dec?.tier,
          action: snap?.classification || dec?.action,
          dailyAvgGb: snap?.dailyAvgGb,
          costPerYear: snap?.costPerYear,
          compositeScore: snap?.compositeScore ?? dec?.compositeScore,
          utilizationScore: snap?.utilizationScore,
          detectionScore: snap?.detectionScore,
          qualityScore: snap?.qualityScore,
          estimatedSavings: snap?.estimatedSavings ?? dec?.estimatedSavings,
          confidence: snap?.confidence ?? dec?.confidenceScore,
          reasoning: snap?.reasoning || dec?.reasoning,
          recommendation: snap?.recommendation || dec?.recommendation,
          isQuickWin: snap?.isQuickWin,
          isS3Candidate: snap?.isS3Candidate,
          detectionGap: snap?.detectionGap,
          governanceStatus: dec?.governanceStatus,
          governanceNote: dec?.governanceNote,
          governanceActor: dec?.governanceActor,
          governanceUpdatedAt: dec?.governanceUpdatedAt,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error loading index');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [indexName]);

  const approveRecommendation = async () => {
    if (!detail || approving || approved) return;
    setApproving(true);
    try {
      await fetch('/api/governance/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mutationType: 'APPROVE',
          indexName: detail.indexName,
          sourcetype: detail.sourcetype || 'unknown',
          actorEmail: 'admin@bitsio.com',
          actionNote: `Approved from index detail page: ${detail.action} — ${fmt$(detail.estimatedSavings)} potential savings`,
          idempotencyKey: `detail-approve-${detail.indexName}-${Date.now()}`,
        }),
      });
      setApproved(true);
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading index data…</div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main style={{ minHeight: '100vh', background: '#050a14', padding: '2rem' }}>
        <Link href="/" style={{ color: '#3b82f6', fontSize: '0.8rem', textDecoration: 'none' }}>← Back to Dashboard</Link>
        <div style={{ marginTop: '2rem', color: '#ef4444', fontSize: '0.9rem' }}>{error || 'Index not found'}</div>
      </main>
    );
  }

  const actionColor = ACTION_COLORS[detail.action || ''] || '#64748b';
  const tierColor = TIER_COLORS[detail.tier || ''] || '#64748b';
  const scoreColor = (v?: number) => !v ? '#64748b' : v >= 70 ? '#22c55e' : v >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <main style={{ minHeight: '100vh', background: '#050a14', padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
        <Link href="/" style={{ color: '#475569', fontSize: '0.78rem', textDecoration: 'none' }}>Dashboard</Link>
        <span style={{ color: '#334155', fontSize: '0.78rem' }}>›</span>
        <Link href="/?tab=telemetry" style={{ color: '#475569', fontSize: '0.78rem', textDecoration: 'none' }}>Telemetry</Link>
        <span style={{ color: '#334155', fontSize: '0.78rem' }}>›</span>
        <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{detail.indexName}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>{detail.indexName}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.tier && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{detail.tier}</span>}
            {detail.action && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: `${actionColor}20`, color: actionColor, fontWeight: 600 }}>→ {detail.action}</span>}
            {detail.sourcetype && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: '#1e293b', color: '#64748b' }}>{detail.sourcetype}</span>}
            {detail.isQuickWin && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: '#22c55e20', color: '#22c55e', fontWeight: 600 }}>⚡ Quick Win</span>}
            {detail.isS3Candidate && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: '#3b82f620', color: '#3b82f6', fontWeight: 600 }}>☁ S3 Candidate</span>}
            {detail.detectionGap && <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.72rem', background: '#ef444420', color: '#ef4444', fontWeight: 600 }}>⚠ Detection Gap</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!approved ? (
            <button onClick={approveRecommendation} disabled={approving}
              style={{ padding: '0.5rem 1.25rem', background: '#22c55e', color: '#0f172a', border: 'none', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: approving ? 'not-allowed' : 'pointer' }}>
              {approving ? '…' : `✓ Approve ${detail.action || 'Action'}`}
            </button>
          ) : (
            <span style={{ padding: '0.5rem 1.25rem', background: '#22c55e20', color: '#22c55e', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700 }}>✓ Approved</span>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Daily Ingest', value: detail.dailyAvgGb != null ? `${detail.dailyAvgGb.toFixed(3)} GB` : '—', color: '#f59e0b' },
          { label: 'Annual Cost', value: fmt$(detail.costPerYear), color: '#ef4444' },
          { label: 'Est. Savings', value: fmt$(detail.estimatedSavings), color: '#22c55e' },
          { label: 'AI Confidence', value: detail.confidence != null ? `${(detail.confidence * 100).toFixed(0)}%` : '—', color: '#3b82f6' },
        ].map(m => (
          <div key={m.label} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Score breakdown + Governance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Score breakdown */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Score Breakdown</div>
          {detail.compositeScore != null && <ScoreBar label="Composite (Overall)" value={detail.compositeScore} color={scoreColor(detail.compositeScore)} />}
          {detail.utilizationScore != null && <ScoreBar label="Utilization" value={detail.utilizationScore} color={scoreColor(detail.utilizationScore)} />}
          {detail.detectionScore != null && <ScoreBar label="Detection Coverage" value={detail.detectionScore} color={scoreColor(detail.detectionScore)} />}
          {detail.qualityScore != null && <ScoreBar label="Data Quality" value={detail.qualityScore} color={scoreColor(detail.qualityScore)} />}
          {!detail.compositeScore && !detail.utilizationScore && (
            <div style={{ color: '#334155', fontSize: '0.8rem' }}>No score data available (LLM pipeline not yet run)</div>
          )}
        </div>

        {/* Governance Status */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Governance Status</div>
          {detail.governanceStatus ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Status:</span>
                <span style={{ padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                  background: detail.governanceStatus === 'APPROVED' ? '#22c55e20' : detail.governanceStatus === 'REJECTED' ? '#ef444420' : '#f59e0b20',
                  color: detail.governanceStatus === 'APPROVED' ? '#22c55e' : detail.governanceStatus === 'REJECTED' ? '#ef4444' : '#f59e0b',
                }}>{detail.governanceStatus}</span>
              </div>
              {detail.governanceActor && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Reviewed by: <span style={{ color: '#94a3b8' }}>{detail.governanceActor}</span></div>}
              {detail.governanceUpdatedAt && <div style={{ fontSize: '0.72rem', color: '#475569' }}>{new Date(detail.governanceUpdatedAt).toLocaleString()}</div>}
              {detail.governanceNote && <div style={{ fontSize: '0.75rem', color: '#64748b', background: '#0a1628', borderRadius: 4, padding: '0.5rem 0.75rem', marginTop: 4, fontStyle: 'italic' }}>"{detail.governanceNote}"</div>}
            </div>
          ) : (
            <div>
              <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '0.75rem' }}>No governance action recorded yet</div>
              <div style={{ fontSize: '0.72rem', color: '#334155' }}>Use the Approve button above to record a governance decision for this index.</div>
            </div>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {(detail.recommendation || detail.reasoning) && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Recommendation</div>
          {detail.recommendation && (
            <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '0.75rem', lineHeight: 1.6 }}>{detail.recommendation}</div>
          )}
          {detail.reasoning && (
            <div style={{ background: '#0a1628', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.7, fontStyle: 'italic', borderLeft: '2px solid #1e293b' }}>
              {detail.reasoning}
            </div>
          )}
        </div>
      )}

      {/* Historical trend placeholder */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Global KPI Trend Context</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginBottom: 6 }}>ROI Score (all indexes)</div>
            <KPITrendChart metric="roi" height={140} showPeriodToggle={false} days={30} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginBottom: 6 }}>Storage Savings Potential</div>
            <KPITrendChart metric="savings" height={140} showPeriodToggle={false} days={30} />
          </div>
        </div>
      </div>
    </main>
  );
}
