'use client';

import React from 'react';
import { ExecutiveSummary } from '../../lib/types';

function fmt$(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  if (v >= 1) return `$${v.toFixed(0)}`;
  if (v > 0) return `$${v.toFixed(2)}`;
  return '$0';
}

function fmtGB(v: number): string {
  if (v < 0.001) return '< 0.001 GB';
  if (v < 1) return `${(v * 1024).toFixed(1)} MB`;
  return `${v.toFixed(1)} GB`;
}

interface Props { summary: ExecutiveSummary; hasAgentDecisions?: boolean; }

function Gauge({ value, max = 100, label, color }: { value: number; max?: number; label: string; color: string }) {
  const pct = Math.min(value / max, 1);
  const angle = pct * 180;
  const r = 60, cx = 80, cy = 80;
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={160} height={95} viewBox="0 0 160 95">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={14} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f8fafc" fontSize={22} fontWeight={700}>{value.toFixed(0)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#64748b" fontSize={10}>/ {max}</text>
      </svg>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: -4 }}>{label}</div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
        <span>{label}</span><span style={{ color: '#f8fafc', fontWeight: 600 }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function MiniGauge({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(value / max, 1);
  const angle = pct * 180;
  const r = 34, cx = 44, cy = 44;
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={88} height={54} viewBox="0 0 88 54">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={9} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />}
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#f8fafc" fontSize={14} fontWeight={700}>{value}</text>
      </svg>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: -6, textAlign: 'center' }}>{label}</div>
    </div>
  );
}

function SpendGauge({ amount, total, label, color }: { amount: number; total: number; label: string; color: string }) {
  const pct = total > 0 ? Math.min(amount / total, 1) : 0;
  const angle = pct * 180;
  const r = 60, cx = 80, cy = 80;
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;
  const pctLabel = total > 0 ? `${(pct * 100).toFixed(0)}% of total` : 'no data';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={160} height={95} viewBox="0 0 160 95">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={14} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#f8fafc" fontSize={17} fontWeight={700}>{fmt$(amount)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize={9}>{pctLabel}</text>
      </svg>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: -4 }}>{label}</div>
    </div>
  );
}

function DonutChart({ segments, size = 140, strokeWidth = 22 }: {
  segments: { label: string; value: number; color: string }[];
  size?: number; strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2 - 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, v) => s + v.value, 0);
  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#475569" fontSize={11}>No data</text>
    </svg>
  );
  let cumLen = 0;
  const arcs = segments.map((seg) => {
    const segLen = (seg.value / total) * circ;
    const off = cumLen; cumLen += segLen;
    return { ...seg, segLen, off };
  });
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      {arcs.map((arc, i) => arc.segLen > 0 ? (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={arc.color} strokeWidth={strokeWidth}
          strokeDasharray={`${arc.segLen} ${circ - arc.segLen}`} strokeDashoffset={-arc.off} />
      ) : null)}
    </svg>
  );
}

const TIER_COLORS: Record<string, string> = {
  critical: '#ef4444', important: '#f59e0b', niceToHave: '#3b82f6', lowValue: '#64748b',
};
const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e', OPTIMIZE: '#f59e0b', ARCHIVE: '#3b82f6', ELIMINATE: '#ef4444', INVESTIGATE: '#8b5cf6',
};

const tierColor = (tier: string) =>
  /critical/i.test(tier) ? '#ef4444' :
  /important/i.test(tier) ? '#f59e0b' :
  /nice/i.test(tier) ? '#3b82f6' : '#64748b';

export default function ExecutiveOverview({ summary, hasAgentDecisions = false }: Props) {
  const { kpis, quickWins, savingsStaircase, agentReasoning, snapshotDate, snapshots } = summary;

  const tierTotal = kpis.tierCounts.critical + kpis.tierCounts.important + kpis.tierCounts.niceToHave + kpis.tierCounts.lowValue;
  const tierBars = [
    { label: 'Critical', key: 'critical', value: kpis.tierCounts.critical, color: TIER_COLORS.critical },
    { label: 'Important', key: 'important', value: kpis.tierCounts.important, color: TIER_COLORS.important },
    { label: 'Nice-to-Have', key: 'niceToHave', value: kpis.tierCounts.niceToHave, color: TIER_COLORS.niceToHave },
    { label: 'Low Value', key: 'lowValue', value: kpis.tierCounts.lowValue, color: TIER_COLORS.lowValue },
  ];

  const actionCounts: Record<string, number> = {};
  snapshots.forEach((s) => { actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1; });

  const staircase = savingsStaircase.length > 0 ? savingsStaircase : (() => {
    const byAction: Record<string, { savings: number; count: number }> = {};
    snapshots.forEach((s) => {
      if (!byAction[s.classification]) byAction[s.classification] = { savings: 0, count: 0 };
      byAction[s.classification].savings += s.estimatedSavings || 0;
      byAction[s.classification].count += 1;
    });
    let cumulative = 0;
    return Object.entries(byAction).filter(([, v]) => v.savings > 0).sort((a, b) => b[1].savings - a[1].savings)
      .map(([action, v]) => { cumulative += v.savings; return { label: action, savings: v.savings, cumulative, action, count: v.count }; });
  })();
  const maxStairSavings = staircase.reduce((m, s) => Math.max(m, s.cumulative), 0) || 1;
  const staircaseHasDelta = staircase.some((s) => s.savings > 0);

  // D7: Score profile by tier
  const tierGroups = [
    { label: 'Critical', match: /critical/i },
    { label: 'Important', match: /important/i },
    { label: 'Nice-to-Have', match: /nice/i },
    { label: 'Low Value', match: /low.value/i },
  ].map(({ label, match }) => {
    const inTier = snapshots.filter(s => match.test(s.tier));
    const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return {
      label, count: inTier.length, color: tierColor(label),
      util: avg(inTier.map(s => s.utilizationScore)),
      detect: avg(inTier.map(s => s.detectionScore)),
      quality: avg(inTier.map(s => s.qualityScore)),
    };
  });

  // D4/D5: Utilized vs Under-Utilized
  const isHighValue = (tier: string) => /critical|important/i.test(tier);
  const utilizedGb = snapshots.reduce((s, v) => s + (isHighValue(v.tier) ? v.dailyAvgGb : 0), 0);
  const underUtilizedGb = snapshots.reduce((s, v) => s + (!isHighValue(v.tier) ? v.dailyAvgGb : 0), 0);
  const utilizedCount = snapshots.filter(s => isHighValue(s.tier)).length;
  const underUtilizedCount = snapshots.filter(s => !isHighValue(s.tier)).length;

  // D9: Annual spend by tier
  const spendByTier = [
    { label: 'Critical', value: snapshots.filter(s => /critical/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.critical },
    { label: 'Important', value: snapshots.filter(s => /important/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.important },
    { label: 'Nice-to-Have', value: snapshots.filter(s => /nice/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.niceToHave },
    { label: 'Low Value', value: snapshots.filter(s => /low.value/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.lowValue },
  ];
  const maxTierSpend = Math.max(...spendByTier.map(t => t.value), 1);

  // D8: Top 6 by volume
  const top6ByVol = [...snapshots].sort((a, b) => b.dailyAvgGb - a.dailyAvgGb).slice(0, 6);
  const maxVol = Math.max(...top6ByVol.map(s => s.dailyAvgGb), 0.001);

  // D12: Archive/S3 candidates
  const archiveCandidates = snapshots.filter(s => s.isS3Candidate || /archive|s3/i.test(s.action));

  // D11: Scatter data
  const scatterData = snapshots;
  const maxGb = Math.max(...scatterData.map(s => s.dailyAvgGb), 0.001);

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', ...extra,
  });
  const cardTitle: React.CSSProperties = {
    fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* D1 — Headline big numbers */}
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', padding: '1rem 1.5rem', background: '#0a1628', borderRadius: 10, border: '1px solid #1e293b', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{fmtGB(kpis.totalDailyGb)}</div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Daily Ingest</div>
        </div>
        <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 300 }}>·</div>
        <div>
          <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{kpis.totalSourcetypes}</div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Indexes</div>
        </div>
        <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 300 }}>·</div>
        <div>
          <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{fmt$(kpis.totalLicenseSpend)}</div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Annual Spend</div>
        </div>
        <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 300 }}>·</div>
        <div>
          <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>{fmt$(kpis.storageSavingsPotential)}</div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Savings Potential</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: kpis.securityGaps > 0 ? '#ef4444' : '#22c55e' }}>{kpis.securityGaps}</div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sec. Gaps</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: kpis.operationalGaps > 0 ? '#f59e0b' : '#22c55e' }}>{kpis.operationalGaps}</div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ops Gaps</div>
          </div>
        </div>
      </div>

      {/* Row 1 — Gauges + KPI Cards (gated by LLM decisions) */}
      {!hasAgentDecisions ? (
        <div style={{ padding: '1.25rem 1.5rem', background: '#0f1a23', border: '1px solid #334155', borderRadius: 12, color: '#94a3b8', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>📊</span>
          <div>
            <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: '0.2rem' }}>Metrics pending</div>
            <div style={{ fontSize: '0.78rem' }}>ROI Score, GainScope Score, and detailed KPI gauges are generated by the LLM pipeline. Run a refresh to populate.</div>
          </div>
        </div>
      ) : null}
      <div style={{ display: hasAgentDecisions ? 'grid' : 'none', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '1rem' }}>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardTitle}>ROI Score</div>
          <Gauge value={kpis.roiScore} label="" color="#22c55e" />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardTitle}>GainScope</div>
          <Gauge value={kpis.gainScopeScore} label="" color="#3b82f6" />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardTitle}>Low-Value Spend</div>
          <SpendGauge amount={kpis.licenseSpendLowValue} total={kpis.totalLicenseSpend} label="" color="#ef4444" />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardTitle}>Savings Potential</div>
          <SpendGauge amount={kpis.storageSavingsPotential} total={kpis.totalLicenseSpend} label="" color="#22c55e" />
        </div>
        <div style={card({ borderLeft: '4px solid #8b5cf6' })}>
          <div style={cardTitle}>Daily Ingest</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>{fmtGB(kpis.totalDailyGb)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{kpis.totalSourcetypes} sourcetypes</div>
        </div>
        <div style={card({ borderLeft: '4px solid #f59e0b' })}>
          <div style={cardTitle}>Coverage Gaps</div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-around' }}>
            <MiniGauge value={kpis.securityGaps} max={Math.max(kpis.securityGaps * 2, 20)} label="Security" color="#ef4444" />
            <MiniGauge value={kpis.operationalGaps} max={Math.max(kpis.operationalGaps * 2, 20)} label="Ops" color="#f59e0b" />
            <MiniGauge value={Math.round(kpis.avgConfidence * 100)} max={100} label="Confidence" color="#22c55e" />
          </div>
        </div>
      </div>

      {/* Row 2 — Tier Distribution + Score Averages + Agent Actions (requires LLM decisions) */}
      {!hasAgentDecisions ? (
        <div style={{ padding: '1.25rem 1.5rem', background: '#1c1008', border: '1px solid #f59e0b40', borderRadius: 12, color: '#f59e0b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>⏳</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>LLM decisions pending</div>
            <div style={{ color: '#b45309', fontSize: '0.78rem' }}>Tier classifications, risk scores, agent actions, and recommendations are hidden until the LLM pipeline completes. Run a Splunk refresh to generate decisions.</div>
          </div>
        </div>
      ) : null}
      <div style={{ display: hasAgentDecisions ? 'grid' : 'none', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div style={card()}>
          <div style={cardTitle}>Tier Distribution <span style={{ color: '#334155' }}>— {tierTotal} indexes</span></div>
          <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: '1rem' }}>
            {tierBars.filter(t => t.value > 0).map((t) => (
              <div key={t.key} style={{ flex: t.value, background: t.color }} title={`${t.label}: ${t.value}`} />
            ))}
          </div>
          {tierBars.map((t) => (
            <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />
                <span style={{ color: '#94a3b8' }}>{t.label}</span>
              </div>
              <span style={{ fontWeight: 600, color: '#f8fafc' }}>{t.value}</span>
            </div>
          ))}
        </div>

        <div style={card()}>
          <div style={cardTitle}>Score Averages</div>
          <ScoreBar label="Utilization" value={kpis.avgUtilization} color="#3b82f6" />
          <ScoreBar label="Detection Coverage" value={kpis.avgDetection} color="#8b5cf6" />
          <ScoreBar label="Data Quality" value={kpis.avgQuality} color="#22c55e" />
          <ScoreBar label="Confidence" value={kpis.avgConfidence * 100} color="#f59e0b" />
          <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
            Snapshot: {snapshotDate ? new Date(snapshotDate).toLocaleDateString() : '—'}
          </div>
        </div>

        <div style={card()}>
          <div style={cardTitle}>Agent Actions</div>
          {Object.entries(actionCounts).length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No actions yet</div>
            : Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).map(([action, count]) => {
                const pct = snapshots.length > 0 ? (count / snapshots.length) * 100 : 0;
                const color = ACTION_COLORS[action] || '#64748b';
                return (
                  <div key={action} style={{ marginBottom: '0.625rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                      <span style={{ color, fontWeight: 600 }}>{action}</span>
                      <span style={{ color: '#94a3b8' }}>{count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })
          }
        </div>
      </div>

      {/* Row 2.5 — D7: Score Profile by Tier (requires LLM decisions) */}
      <div style={{ ...card(), display: hasAgentDecisions ? undefined : 'none' }}>
        <div style={cardTitle}>Score Profile by Tier</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.25rem' }}>
          {tierGroups.map(tg => (
            <div key={tg.label} style={{ borderTop: `3px solid ${tg.color}`, paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: tg.color }}>{tg.label}</span>
                <span style={{ fontSize: '0.7rem', color: '#475569' }}>{tg.count} index{tg.count !== 1 ? 'es' : ''}</span>
              </div>
              {tg.count === 0
                ? <div style={{ color: '#334155', fontSize: '0.75rem', fontStyle: 'italic' }}>No indexes</div>
                : ([['Utilization', tg.util], ['Detection', tg.detect], ['Quality', tg.quality]] as [string, number][]).map(([lbl, val]) => (
                  <div key={lbl} style={{ marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', marginBottom: '0.15rem' }}>
                      <span>{lbl}</span>
                      <span style={{ color: val >= 70 ? '#22c55e' : val >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{val.toFixed(0)}</span>
                    </div>
                    <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(val, 100)}%`, background: tg.color, borderRadius: 3, opacity: 0.75 }} />
                    </div>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      </div>

      {/* Row 3 — D4/D5 Donut Pies + D9 Annual Spend by Tier */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>

        {/* D4: Data Volume Split */}
        <div style={card()}>
          <div style={cardTitle}>Data Volume Split</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.875rem' }}>
            <DonutChart segments={[
              { label: 'Utilized', value: utilizedGb, color: '#22c55e' },
              { label: 'Under-Utilized', value: underUtilizedGb, color: '#ef4444' },
            ]} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[['Utilized', utilizedGb, '#22c55e'], ['Under-Utilized', underUtilizedGb, '#ef4444']].map(([lbl, val, col]) => (
              <div key={lbl as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94a3b8' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col as string, display: 'inline-block' }} />{lbl}
                </span>
                <span style={{ color: col as string, fontWeight: 600 }}>{fmtGB(val as number)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* D5: Sourcetype Count Split */}
        <div style={card()}>
          <div style={cardTitle}>Sourcetype Split</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.875rem' }}>
            <DonutChart segments={[
              { label: 'Utilized', value: utilizedCount, color: '#22c55e' },
              { label: 'Under-Utilized', value: underUtilizedCount, color: '#ef4444' },
            ]} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[['Utilized', utilizedCount, '#22c55e'], ['Under-Utilized', underUtilizedCount, '#ef4444']].map(([lbl, val, col]) => (
              <div key={lbl as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94a3b8' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col as string, display: 'inline-block' }} />{lbl}
                </span>
                <span style={{ color: col as string, fontWeight: 600 }}>{val} indexes</span>
              </div>
            ))}
          </div>
        </div>

        {/* D9: Annual License Spend by Tier */}
        <div style={card()}>
          <div style={cardTitle}>Annual License Spend by Tier</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {spendByTier.map((tier) => (
              <div key={tier.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#94a3b8' }}>{tier.label}</span>
                  <span style={{ color: tier.color, fontWeight: 600 }}>{fmt$(tier.value)}</span>
                </div>
                <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${maxTierSpend > 0 ? (tier.value / maxTierSpend) * 100 : 0}%`, background: tier.color, borderRadius: 4, minWidth: tier.value > 0 ? 2 : 0 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4 — Savings Staircase + Quick Wins */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={card()}>
          <div style={cardTitle}>Savings Staircase</div>
          {staircase.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No savings data yet</div>
            : !staircaseHasDelta
            ? (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '0.75rem' }}>
                  {staircase.map((step, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.375rem 0.5rem', background: '#1e293b', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>{step.label}</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmt$(step.cumulative)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic' }}>No cost reduction projected — all tiers at current spend level</div>
              </div>
            )
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {staircase.map((step, i) => {
                  const widthPct = Math.max(4, (step.cumulative / maxStairSavings) * 100);
                  const color = ACTION_COLORS[step.action] || '#3b82f6';
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                        <span style={{ color: '#94a3b8' }}>{step.label}</span>
                        <span style={{ color: step.savings > 0 ? '#22c55e' : '#f8fafc', fontWeight: 600 }}>
                          {step.savings > 0 ? `−${fmt$(step.savings)}` : fmt$(step.cumulative)}
                        </span>
                      </div>
                      <div style={{ height: 20, background: '#1e293b', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{ height: '100%', width: `${widthPct}%`, background: `${color}30`, borderRadius: 4 }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: '0.65rem', color: '#64748b' }}>
                          {fmt$(step.cumulative)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>

        <div style={card()}>
          <div style={cardTitle}>Quick Wins</div>
          {(() => {
            const wins = quickWins.length > 0
              ? quickWins.slice(0, 5).map(qw => ({ indexName: qw.indexName, action: qw.action, savings: qw.savings, tier: qw.tier, reasoning: qw.reasoning }))
              : snapshots.filter(s => s.isQuickWin).slice(0, 5).map(s => ({ indexName: s.indexName, action: s.action, savings: s.estimatedSavings, tier: s.tier, reasoning: s.reasoning }));
            if (wins.length === 0) return <div style={{ color: '#475569', fontSize: '0.875rem' }}>No quick wins identified</div>;
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b' }}>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 500, width: 28 }}>#</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 500 }}>Index</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>Est. Impact</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 500 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {wins.map((qw, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                      <td style={{ padding: '0.5rem 0.5rem', color: '#475569', fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: '0.5rem 0.5rem' }}>
                        <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.2rem' }}>{qw.indexName}</div>
                        <span style={{ padding: '0.1rem 0.35rem', borderRadius: 3, fontSize: '0.62rem', background: `${ACTION_COLORS[qw.action] || '#3b82f6'}20`, color: ACTION_COLORS[qw.action] || '#3b82f6', fontWeight: 600 }}>{qw.action}</span>
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem', color: '#22c55e', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{qw.savings > 0 ? fmt$(qw.savings) : '—'}</td>
                      <td style={{ padding: '0.5rem 0.5rem', color: '#64748b', fontSize: '0.72rem', maxWidth: 160 }}>
                        {qw.reasoning ? qw.reasoning.slice(0, 80) + (qw.reasoning.length > 80 ? '…' : '') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>

      {/* Row 5 — D11 Utilization×Detection Scatter + D8 Top Indexes by Volume */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* D11: Utilization × Detection Quadrant */}
        <div style={card()}>
          <div style={cardTitle}>Utilization × Detection</div>
          {scatterData.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No data</div>
            : (() => {
                const W = 360, H = 200, MX = 30, MY = 14;
                const PW = W - 2 * MX, PH = H - 2 * MY;
                const mapX = (v: number) => MX + (v / 100) * PW;
                const mapY = (v: number) => H - MY - (v / 100) * PH;
                return (
                  <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
                    {/* Quadrant fills: top-left=LU/HD, top-right=HU/HD(best), bottom-left=LU/LD, bottom-right=HU/LD */}
                    <rect x={MX} y={MY} width={PW / 2} height={PH / 2} fill="#3b82f608" />
                    <rect x={MX + PW / 2} y={MY} width={PW / 2} height={PH / 2} fill="#22c55e08" />
                    <rect x={MX} y={MY + PH / 2} width={PW / 2} height={PH / 2} fill="#ef444408" />
                    <rect x={MX + PW / 2} y={MY + PH / 2} width={PW / 2} height={PH / 2} fill="#f59e0b08" />
                    {/* Midlines */}
                    <line x1={mapX(50)} y1={MY} x2={mapX(50)} y2={H - MY} stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3" />
                    <line x1={MX} y1={mapY(50)} x2={W - MX} y2={mapY(50)} stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3" />
                    {/* Axis labels */}
                    <text x={W / 2} y={H - 1} textAnchor="middle" fill="#334155" fontSize={9}>Utilization →</text>
                    <text x={8} y={H / 2} textAnchor="middle" fill="#334155" fontSize={9} transform={`rotate(-90,8,${H / 2})`}>Detection →</text>
                    {/* Quadrant labels */}
                    <text x={MX + 4} y={MY + 10} fill="#3b82f6" fontSize={8} opacity={0.7}>LU/HD</text>
                    <text x={W - MX - 4} y={MY + 10} textAnchor="end" fill="#22c55e" fontSize={8} opacity={0.7}>HU/HD ✓</text>
                    <text x={MX + 4} y={H - MY - 4} fill="#ef4444" fontSize={8} opacity={0.7}>LU/LD</text>
                    <text x={W - MX - 4} y={H - MY - 4} textAnchor="end" fill="#f59e0b" fontSize={8} opacity={0.7}>HU/LD</text>
                    {/* Bubbles */}
                    {scatterData.map((s, i) => {
                      const bR = Math.min(Math.max(Math.sqrt(s.dailyAvgGb / maxGb) * 16 + 3, 4), 18);
                      const col = tierColor(s.tier);
                      return (
                        <circle key={i} cx={mapX(s.utilizationScore)} cy={mapY(s.detectionScore)}
                          r={bR} fill={col} fillOpacity={0.65} stroke={col} strokeWidth={1} strokeOpacity={0.9}>
                          <title>{s.indexName}: Util={s.utilizationScore.toFixed(0)}, Det={s.detectionScore.toFixed(0)}, {fmtGB(s.dailyAvgGb)}/day</title>
                        </circle>
                      );
                    })}
                  </svg>
                );
              })()
          }
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {[['Critical', '#ef4444'], ['Important', '#f59e0b'], ['Nice-to-Have', '#3b82f6'], ['Low Value', '#64748b']].map(([lbl, col]) => (
              <span key={lbl} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.65rem', color: '#94a3b8' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, display: 'inline-block' }} />{lbl}
              </span>
            ))}
          </div>
        </div>

        {/* D8: Top Indexes by Volume */}
        <div style={card()}>
          <div style={cardTitle}>Top Indexes by Volume</div>
          {top6ByVol.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No data</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {top6ByVol.map((s) => {
                  const pct = (s.dailyAvgGb / maxVol) * 100;
                  const col = tierColor(s.tier);
                  return (
                    <div key={s.indexName}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                        <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>{s.indexName}</span>
                        <span style={{ color: col, fontWeight: 600 }}>{fmtGB(s.dailyAvgGb)}/d</span>
                      </div>
                      <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>

      {/* Row 6 — D12: S3 / Archive Candidates Table */}
      {archiveCandidates.length > 0 && (
        <div style={card()}>
          <div style={cardTitle}>S3 / Archive Candidates — {archiveCandidates.length} indexes</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Index', 'Tier', 'Score', 'GB/Day', 'License/Yr', 'Utilization', 'Detection', 'Action'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {archiveCandidates.slice(0, 10).map((s, i) => {
                  const col = tierColor(s.tier);
                  const actColor = ACTION_COLORS[s.action] || '#3b82f6';
                  return (
                    <tr key={s.indexName} style={{ borderBottom: '1px solid #0f172a', background: i % 2 ? '#ffffff05' : 'transparent' }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600, background: col + '20', color: col }}>{s.tier}</span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.compositeScore.toFixed(0)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#cbd5e1' }}>{fmtGB(s.dailyAvgGb)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#cbd5e1' }}>{fmt$(s.costPerYear)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.utilizationScore.toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.detectionScore.toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ padding: '0.2rem 0.5rem', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, background: actColor + '20', color: actColor }}>{s.action}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {archiveCandidates.length > 10 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
              Showing 10 of {archiveCandidates.length} candidates
            </div>
          )}
        </div>
      )}

      {/* Row 7 — Agent Reasoning */}
      {agentReasoning && (
        <div style={{ ...card(), borderLeft: '4px solid #3b82f6' }}>
          <div style={cardTitle}>🧠 Agent Reasoning</div>
          <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{agentReasoning}</p>
        </div>
      )}
    </div>
  );
}

function QuickWinRow({ indexName, action, savings, tier, reasoning }: {
  indexName: string; action: string; savings: number; tier: string; reasoning: string;
}) {
  return (
    <div style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.875rem' }}>{indexName}</span>
        <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.875rem' }}>{savings > 0 ? fmt$(savings) : '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', background: `${ACTION_COLORS[action] || '#3b82f6'}20`, color: ACTION_COLORS[action] || '#3b82f6', fontWeight: 600 }}>{action}</span>
        <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', background: '#1e293b', color: '#94a3b8' }}>{tier}</span>
      </div>
      {reasoning && <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>{reasoning.slice(0, 120)}{reasoning.length > 120 ? '…' : ''}</div>}
    </div>
  );
}
