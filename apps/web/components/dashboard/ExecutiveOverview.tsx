'use client';

import React, { useState } from 'react';
import { ExecutiveSummary } from '../../lib/types';
import ReasoningDrawer from '../shared/ReasoningDrawer';
import KPITrendChart from '../KPITrendChart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';

function fmt$(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  if (n > 0) return `$${n.toFixed(2)}`;
  return '$0';
}

function fmtGB(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || n < 0.001) return '< 0.001 GB';
  if (n < 1) return `${(n * 1024).toFixed(1)} MB`;
  return `${n.toFixed(1)} GB`;
}

interface Props {
  summary: ExecutiveSummary;
  hasAgentDecisions?: boolean;
  explainabilityEnabled?: boolean;
}

function Gauge({ value, max = 100, label, color, onClick }: { value: number; max?: number; label: string; color: string; onClick?: () => void }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <svg width={160} height={95} viewBox="0 0 160 95" style={{ opacity: onClick ? 1 : 1, transition: 'opacity 0.2s' }}>
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
  const r = 28, cx = 36, cy = 36;
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={72} height={46} viewBox="0 0 72 46">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={8} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />}
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

interface DrawerState {
  isOpen: boolean;
  metric: string;
  value: string | number;
  title: string;
  howCalculated: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  candidateReason?: string[];
  rawData?: Record<string, unknown>;
}

export default function ExecutiveOverview({ summary, hasAgentDecisions = false, explainabilityEnabled = false }: Props) {
  const { kpis, quickWins = [], savingsStaircase = [], agentReasoning = '', snapshotDate, snapshots = [] } = summary;
  const [drawer, setDrawer] = useState<DrawerState>({ isOpen: false, metric: '', value: '', title: '', howCalculated: '' });
  const openDrawer = (next: DrawerState): void => {
    if (!explainabilityEnabled) return;
    setDrawer(next);
  };

  const tierTotal = kpis.tierCounts.critical + kpis.tierCounts.important + kpis.tierCounts.niceToHave + kpis.tierCounts.lowValue;
  const tierBars = [
    { label: 'Critical', key: 'critical', value: kpis.tierCounts.critical, color: TIER_COLORS.critical },
    { label: 'Important', key: 'important', value: kpis.tierCounts.important, color: TIER_COLORS.important },
    { label: 'Nice-to-Have', key: 'niceToHave', value: kpis.tierCounts.niceToHave, color: TIER_COLORS.niceToHave },
    { label: 'Low Value', key: 'lowValue', value: kpis.tierCounts.lowValue, color: TIER_COLORS.lowValue },
  ];

  const actionCounts: Record<string, number> = {};
  snapshots.forEach((s) => { actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1; });

  const staircase = savingsStaircase && savingsStaircase.length > 0 ? savingsStaircase : (() => {
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

      {/* Action required strip — shows per-action counts */}
      {hasAgentDecisions && snapshots.length > 0 && (() => {
        const actionCounts: Record<string, number> = {};
        const actionSavings: Record<string, number> = {};
        for (const s of snapshots) {
          if (s.classification) {
            actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1;
            actionSavings[s.classification] = (actionSavings[s.classification] || 0) + (s.estimatedSavings || 0);
          }
        }
        const entries = Object.entries(actionCounts).sort((a, b) => {
          const order = ['ELIMINATE', 'ARCHIVE', 'OPTIMIZE', 'INVESTIGATE', 'KEEP'];
          return order.indexOf(a[0]) - order.indexOf(b[0]);
        });
        if (entries.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {entries.map(([action, count]) => {
              const color = ACTION_COLORS[action] || '#64748b';
              const savings = actionSavings[action] || 0;
              return (
                <div key={action} style={{ flex: 1, minWidth: 100, padding: '0.75rem 1rem', background: `${color}10`, border: `1px solid ${color}35`, borderRadius: 8, cursor: 'default' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: '0.68rem', color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{action}</div>
                  {savings > 0 && <div style={{ fontSize: '0.65rem', color: '#22c55e', marginTop: 3 }}>~{fmt$(savings)}</div>}
                </div>
              );
            })}
          </div>
        );
      })()}

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
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>ROI Score</div>
          <Gauge
            value={kpis.roiScore}
            label=""
            color="#22c55e"
            onClick={() => openDrawer({
              isOpen: true,
              metric: 'roi_score',
              value: kpis.roiScore,
              title: `ROI Score: ${kpis.roiScore.toFixed(0)}`,
              howCalculated: `ROI Score = (Total Savings Potential / Annual Spend) × 100\n\nCritical: ${kpis.tierCounts.critical}\nImportant: ${kpis.tierCounts.important}\nNice-to-Have: ${kpis.tierCounts.niceToHave}\nLow Value: ${kpis.tierCounts.lowValue}\n\nThe score combines tier distribution with potential cost savings.`,
              llmReasoning: agentReasoning,
              evidence: [
                `Savings potential: ${fmt$(kpis.storageSavingsPotential)}`,
                `Current annual spend: ${fmt$(kpis.totalLicenseSpend)}`,
                `${kpis.tierCounts.lowValue} low-value indexes identified`,
                `${kpis.tierCounts.critical + kpis.tierCounts.important} high-value indexes protected`,
              ],
              confidence: kpis.avgConfidence * 100,
              rawData: {
                tierCounts: kpis.tierCounts,
                roiScore: kpis.roiScore,
                storageSavingsPotential: kpis.storageSavingsPotential,
                totalLicenseSpend: kpis.totalLicenseSpend,
              },
            })}
          />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>GainScope</div>
          <Gauge
            value={kpis.gainScopeScore}
            label=""
            color="#3b82f6"
            onClick={() => openDrawer({
              isOpen: true,
              metric: 'gainscope_score',
              value: kpis.gainScopeScore,
              title: `GainScope Score: ${kpis.gainScopeScore.toFixed(0)}`,
              howCalculated: `GainScope Score = (Utilization + Detection + Quality) / 3\n\nUtilization: ${kpis.avgUtilization.toFixed(0)}%\nDetection Coverage: ${kpis.avgDetection.toFixed(0)}%\nData Quality: ${kpis.avgQuality.toFixed(0)}%\n\nMeasures overall data health and business impact.`,
              llmReasoning: agentReasoning,
              evidence: [
                `Average utilization score: ${kpis.avgUtilization.toFixed(0)}%`,
                `Average detection coverage: ${kpis.avgDetection.toFixed(0)}%`,
                `Average data quality: ${kpis.avgQuality.toFixed(0)}%`,
                `${kpis.totalSourcetypes} indexes analyzed`,
              ],
              confidence: kpis.avgConfidence * 100,
              rawData: {
                gainScopeScore: kpis.gainScopeScore,
                avgUtilization: kpis.avgUtilization,
                avgDetection: kpis.avgDetection,
                avgQuality: kpis.avgQuality,
              },
            })}
          />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>Low-Value Spend</div>
          <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
            isOpen: true,
            metric: 'license_spend_low_value',
            value: kpis.licenseSpendLowValue,
            title: `Low-Value Spend: ${fmt$(kpis.licenseSpendLowValue)}`,
            howCalculated: `Low-Value Spend = Annual cost of indexes classified as Low Value tier\n\nLow-Value indexes: ${kpis.tierCounts.lowValue}\nTotal annual spend: ${fmt$(kpis.totalLicenseSpend)}\nPercentage: ${kpis.totalLicenseSpend > 0 ? ((kpis.licenseSpendLowValue / kpis.totalLicenseSpend) * 100).toFixed(1) : 0}%`,
            llmReasoning: agentReasoning,
            evidence: [
              `${kpis.tierCounts.lowValue} indexes classified as low-value`,
              `Annual cost: ${fmt$(kpis.licenseSpendLowValue)}`,
              `Potential savings: ${fmt$(kpis.storageSavingsPotential)}`,
              `Recommended action: Archive or eliminate low-utilization indexes`,
            ],
            confidence: kpis.avgConfidence * 100,
            rawData: {
              licenseSpendLowValue: kpis.licenseSpendLowValue,
              lowValueCount: kpis.tierCounts.lowValue,
              totalLicenseSpend: kpis.totalLicenseSpend,
            },
          })}>
            <SpendGauge amount={kpis.licenseSpendLowValue} total={kpis.totalLicenseSpend} label="" color="#ef4444" />
          </div>
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>Savings Potential</div>
          <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
            isOpen: true,
            metric: 'storage_savings_potential',
            value: kpis.storageSavingsPotential,
            title: `Savings Potential: ${fmt$(kpis.storageSavingsPotential)}`,
            howCalculated: `Savings Potential = Sum of cost reduction from optimization and elimination actions\n\nARCHIVE savings: Reduce retention on cold data\nELIMINATE savings: Remove unused indexes\nOPTIMIZE savings: Reduce daily ingest through deduplication`,
            llmReasoning: agentReasoning,
            evidence: [
              `Estimated annual savings: ${fmt$(kpis.storageSavingsPotential)}`,
              `Percentage of current spend: ${kpis.totalLicenseSpend > 0 ? ((kpis.storageSavingsPotential / kpis.totalLicenseSpend) * 100).toFixed(1) : 0}%`,
              `Low-value spend to reduce: ${fmt$(kpis.licenseSpendLowValue)}`,
              `${kpis.tierCounts.critical + kpis.tierCounts.important} high-value indexes remain protected`,
            ],
            confidence: kpis.avgConfidence * 100,
            rawData: {
              storageSavingsPotential: kpis.storageSavingsPotential,
              totalLicenseSpend: kpis.totalLicenseSpend,
              licenseSpendLowValue: kpis.licenseSpendLowValue,
            },
          })}>
            <SpendGauge amount={kpis.storageSavingsPotential} total={kpis.totalLicenseSpend} label="" color="#22c55e" />
          </div>
        </div>
        <div style={{ ...card({ borderLeft: '4px solid #8b5cf6' }), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
          <div style={cardTitle}>Daily Ingest</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>{fmtGB(kpis.totalDailyGb)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{kpis.totalSourcetypes} sourcetypes</div>
        </div>
        <div style={{ ...card({ borderLeft: '4px solid #f59e0b' }), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>Coverage Gaps</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.4rem', alignItems: 'start' }}>
            <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
              isOpen: true,
              metric: 'security_gaps',
              value: kpis.securityGaps,
              title: `Security Gaps: ${kpis.securityGaps}`,
              howCalculated: `Security Gaps = Sourcetypes not mapped to MITRE security framework\n\nTotal indexes: ${kpis.totalSourcetypes}\nWith security coverage: ${kpis.totalSourcetypes - kpis.securityGaps}\nGap percentage: ${kpis.totalSourcetypes > 0 ? ((kpis.securityGaps / kpis.totalSourcetypes) * 100).toFixed(1) : 0}%`,
              llmReasoning: agentReasoning,
              evidence: [
                `${kpis.securityGaps} indexes lack detection coverage`,
                `Recommendation: Implement detection rules for security-sensitive data`,
                `Prioritize critical and important tier indexes`,
              ],
              confidence: kpis.avgConfidence * 100,
              rawData: {
                securityGaps: kpis.securityGaps,
                totalSourcetypes: kpis.totalSourcetypes,
              },
            })}>
              <MiniGauge value={kpis.securityGaps} max={Math.max(kpis.securityGaps * 2, 20)} label="Security" color="#ef4444" />
            </div>
            <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
              isOpen: true,
              metric: 'operational_gaps',
              value: kpis.operationalGaps,
              title: `Operational Gaps: ${kpis.operationalGaps}`,
              howCalculated: `Operational Gaps = Sourcetypes not supporting key operational use cases\n\nTotal indexes: ${kpis.totalSourcetypes}\nSupporting operations: ${kpis.totalSourcetypes - kpis.operationalGaps}\nGap percentage: ${kpis.totalSourcetypes > 0 ? ((kpis.operationalGaps / kpis.totalSourcetypes) * 100).toFixed(1) : 0}%`,
              llmReasoning: agentReasoning,
              evidence: [
                `${kpis.operationalGaps} indexes have operational gaps`,
                `Recommendation: Review operational requirements and align indexing strategy`,
                `Consider consolidation where operational overlap exists`,
              ],
              confidence: kpis.avgConfidence * 100,
              rawData: {
                operationalGaps: kpis.operationalGaps,
                totalSourcetypes: kpis.totalSourcetypes,
              },
            })}>
              <MiniGauge value={kpis.operationalGaps} max={Math.max(kpis.operationalGaps * 2, 20)} label="Ops" color="#f59e0b" />
            </div>
            <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
              isOpen: true,
              metric: 'avg_confidence',
              value: Math.round(kpis.avgConfidence * 100),
              title: `Confidence Score: ${Math.round(kpis.avgConfidence * 100)}%`,
              howCalculated: `Confidence Score = Average confidence of LLM decisions across all indexes\n\nBased on:\n• Evidence quality (utilization data, detection patterns)\n• Classification agreement with tier patterns\n• Data completeness and freshness`,
              llmReasoning: agentReasoning,
              evidence: [
                `Overall LLM decision confidence: ${(kpis.avgConfidence * 100).toFixed(1)}%`,
                `Higher confidence indicates stronger classification signals`,
                `Low confidence suggests need for manual review of edge cases`,
              ],
              confidence: kpis.avgConfidence * 100,
              rawData: {
                avgConfidence: kpis.avgConfidence,
                confidencePercent: Math.round(kpis.avgConfidence * 100),
              },
            })}>
              <MiniGauge value={Math.round(kpis.avgConfidence * 100)} max={100} label="Confidence" color="#22c55e" />
            </div>
          </div>
        </div>
      </div>

      {/* Trend Charts — Historical KPI Tracking with synced period selector */}
      {(() => {
        const [trendDays, setTrendDays] = React.useState<7|30|90>(7);
        return (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  📈 KPI Trends
                </h2>
                <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>Historical tracking across all key metrics</p>
              </div>
              {/* Global period selector */}
              <div style={{ display: 'flex', gap: 6 }}>
                {([7, 30, 90] as const).map(d => (
                  <button key={d} onClick={() => setTrendDays(d)} style={{
                    padding: '0.35rem 0.75rem', fontSize: '0.72rem', fontWeight: 700,
                    background: trendDays === d ? '#3b82f6' : '#1e293b',
                    color: trendDays === d ? '#fff' : '#64748b',
                    border: `1px solid ${trendDays === d ? '#3b82f6' : '#334155'}`,
                    borderRadius: 5, cursor: 'pointer',
                  }}>{d}d</button>
                ))}
              </div>
            </div>

            {/* Row 1 — Business KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {[
                { metric: 'roi'       as const, title: '🏆 ROI Score' },
                { metric: 'gainscope' as const, title: '🎯 GainScope %' },
                { metric: 'savings'   as const, title: '💰 Savings Potential' },
                { metric: 'ingest'    as const, title: '📦 Daily Ingest (GB)' },
              ].map(({ metric, title }) => (
                <div key={metric} style={{ padding: '1rem 1.25rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
                    {explainabilityEnabled ? (
                      <button
                        data-testid={`chart-explain-${metric}`}
                        onClick={() => openDrawer({
                          isOpen: true,
                          metric: `${metric}_trend_chart`,
                          value: 'Trend',
                          title: `${title} Trend`,
                          howCalculated: `Chart: ${title}\nX-axis: Date\nY-axis: ${title}\nFormula: derived from executive_kpis history`,
                          evidence: [
                            `Inputs: executive_kpis snapshots (${trendDays} days)`,
                            `Source origin: executive_kpis`,
                            `Confidence: ${(kpis.avgConfidence * 100).toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: kpis.avgConfidence * 100,
                        })}
                        style={{ border: '1px solid #334155', background: '#0b1220', color: '#cbd5e1', borderRadius: 6, padding: '0.2rem 0.45rem', cursor: 'pointer', fontSize: '0.72rem' }}
                      >
                        ⓘ
                      </button>
                    ) : null}
                  </div>
                  <KPITrendChart metric={metric} days={trendDays} height={200} showPeriodToggle={false} />
                </div>
              ))}
            </div>

            {/* Row 2 — Score dimensions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              {[
                { metric: 'utilization' as const, title: '⚡ Avg Utilization' },
                { metric: 'quality'     as const, title: '✅ Avg Data Quality' },
                { metric: 'confidence'  as const, title: '🤖 Avg AI Confidence' },
              ].map(({ metric, title }) => (
                <div key={metric} style={{ padding: '1rem 1.25rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
                    {explainabilityEnabled ? (
                      <button
                        data-testid={`chart-explain-${metric}`}
                        onClick={() => openDrawer({
                          isOpen: true,
                          metric: `${metric}_trend_chart`,
                          value: 'Trend',
                          title: `${title} Trend`,
                          howCalculated: `Chart: ${title}\nX-axis: Date\nY-axis: ${title}\nFormula: derived from executive_kpis history`,
                          evidence: [
                            `Inputs: executive_kpis snapshots (${trendDays} days)`,
                            `Source origin: executive_kpis`,
                            `Confidence: ${(kpis.avgConfidence * 100).toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: kpis.avgConfidence * 100,
                        })}
                        style={{ border: '1px solid #334155', background: '#0b1220', color: '#cbd5e1', borderRadius: 6, padding: '0.2rem 0.45rem', cursor: 'pointer', fontSize: '0.72rem' }}
                      >
                        ⓘ
                      </button>
                    ) : null}
                  </div>
                  <KPITrendChart metric={metric} days={trendDays} height={160} showPeriodToggle={false} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>Tier Distribution <span style={{ color: '#334155' }}>— {tierTotal} indexes</span></div>
          <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: '1rem' }}>
            {tierBars.filter(t => t.value > 0).map((t) => (
              <div key={t.key} style={{ flex: t.value, background: t.color }} title={`${t.label}: ${t.value}`} />
            ))}
          </div>
          {tierBars.map((t) => {
            const tierSnaps = snapshots.filter(s => new RegExp(t.label.toLowerCase(), 'i').test(s.tier));
            const tierSpend = tierSnaps.reduce((s, v) => s + v.costPerYear, 0);
            return (
              <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: 4, transition: 'background 0.15s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#ffffff03'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} onClick={() => openDrawer({
                isOpen: true,
                metric: `tier_${t.key}`,
                value: t.value,
                title: `Tier: ${t.label}`,
                howCalculated: `Tier classification is determined by the LLM based on:\n• Utilization (how much data is actually used)\n• Detection importance (security/compliance needs)\n• Data quality and retention requirements\n• Business criticality`,
                llmReasoning: agentReasoning,
                evidence: [
                  `${t.value} indexes classified as ${t.label}`,
                  `Annual spend: ${fmt$(tierSpend)}`,
                  `Average utilization: ${tierSnaps.length > 0 ? (tierSnaps.reduce((s, v) => s + v.utilizationScore, 0) / tierSnaps.length).toFixed(0) : 0}%`,
                  `Average detection: ${tierSnaps.length > 0 ? (tierSnaps.reduce((s, v) => s + v.detectionScore, 0) / tierSnaps.length).toFixed(0) : 0}%`,
                  `Recommendation: ${t.label === 'Critical' ? 'Maintain strict retention and uptime' : t.label === 'Important' ? 'Optimize retention and monitor usage' : t.label === 'Nice-to-Have' ? 'Evaluate utility; archive if unused' : 'Eliminate or archive'}`,
                ],
                confidence: kpis.avgConfidence * 100,
                tier: t.label,
                rawData: {
                  tier: t.label,
                  indexCount: t.value,
                  totalSpend: tierSpend,
                  percentage: tierTotal > 0 ? (t.value / tierTotal) * 100 : 0,
                },
              })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />
                  <span style={{ color: '#94a3b8' }}>{t.label}</span>
                </div>
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>{t.value}</span>
              </div>
            );
          })}
        </div>

        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>Score Averages</div>
          <ScoreBar label="Utilization" value={kpis.avgUtilization} color="#3b82f6" />
          <ScoreBar label="Detection Coverage" value={kpis.avgDetection} color="#8b5cf6" />
          <ScoreBar label="Data Quality" value={kpis.avgQuality} color="#22c55e" />
          <ScoreBar label="Confidence" value={kpis.avgConfidence * 100} color="#f59e0b" />
          <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
            Snapshot: {snapshotDate ? new Date(snapshotDate).toLocaleDateString() : '—'}
          </div>
        </div>

        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
      <div style={{ ...card(), display: hasAgentDecisions ? undefined : 'none', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
            : (() => {
                const chartData = staircase.map((step, i) => ({
                  label: step.label,
                  action: step.action,
                  savings: step.savings,
                  cumulative: step.cumulative,
                  index: i,
                }));
                return (
                  <div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                        onClick={(d) => {
                          if (!d || !d.activePayload) return;
                          const step = d.activePayload[0]?.payload;
                          if (!step) return;
                          const actionCount = snapshots.filter(s => s.action === step.action).length;
                          openDrawer({
                            isOpen: true,
                            metric: `${step.action.toLowerCase()}_savings`,
                            value: step.savings,
                            title: `${step.label} Savings: ${fmt$(step.savings)}`,
                            howCalculated: `${step.label} Savings = Sum of cost reduction from ${step.action.toLowerCase()} actions\n\nAction count: ${actionCount} indexes\nPer-action avg savings: ${fmt$(step.savings / Math.max(actionCount, 1))}\nCumulative total: ${fmt$(step.cumulative)}`,
                            llmReasoning: agentReasoning,
                            evidence: [
                              `${actionCount} indexes classified for ${step.action.toLowerCase()}`,
                              `Estimated savings: ${fmt$(step.savings)}`,
                              `${step.action} indexes in this tier: ${actionCount}`,
                              `Recommendation: Prioritize by confidence and impact`,
                            ],
                            confidence: kpis.avgConfidence * 100,
                            action: step.action,
                            rawData: { action: step.action, savings: step.savings, cumulative: step.cumulative, count: actionCount },
                          });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} stroke="#334155" />
                        <YAxis tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} tick={{ fill: '#64748b', fontSize: 10 }} stroke="#334155" />
                        <Tooltip
                          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, fontSize: '0.75rem' }}
                          labelStyle={{ color: '#cbd5e1' }}
                          formatter={(value: number, name: string) => [
                            name === 'cumulative' ? `Cumulative: ${fmt$(value)}` : `Savings: ${fmt$(value)}`,
                            name === 'cumulative' ? 'Cumulative' : 'Phase Savings',
                          ]}
                        />
                        <Bar dataKey="savings" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                          {chartData.map((entry, i) => (
                            <Cell key={i} fill={ACTION_COLORS[entry.action] || '#3b82f6'} fillOpacity={0.85} />
                          ))}
                        </Bar>
                        <Bar dataKey="cumulative" isAnimationActive={false} radius={[3, 3, 0, 0]} fillOpacity={0.25}>
                          {chartData.map((entry, i) => (
                            <Cell key={i} fill={ACTION_COLORS[entry.action] || '#3b82f6'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                      {chartData.map((step, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem' }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: ACTION_COLORS[step.action] || '#3b82f6' }} />
                          <span style={{ color: '#64748b' }}>{step.label}</span>
                          <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt$(step.savings)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
          }
        </div>

        {/* Quick Wins — one-click governance panel */}
        {(() => {
          const [approvedWins, setApprovedWins] = React.useState<Set<string>>(new Set());
          const [approvingWin, setApprovingWin] = React.useState<string | null>(null);

          const wins = quickWins.length > 0
            ? quickWins.slice(0, 5).map(qw => ({ indexName: qw.indexName, action: qw.action, savings: qw.savings, tier: qw.tier, reasoning: qw.reasoning }))
            : snapshots.filter(s => s.isQuickWin).slice(0, 5).map(s => ({ indexName: s.indexName, action: s.action, savings: s.estimatedSavings, tier: s.tier, reasoning: s.reasoning }));

          const approveWin = async (qw: typeof wins[0]) => {
            const key = `${qw.indexName}::${qw.action}`;
            if (approvedWins.has(key) || approvingWin === key) return;
            setApprovingWin(key);
            try {
              await fetch('/api/governance/mutations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mutationType: 'APPROVE',
                  indexName: qw.indexName,
                  sourcetype: qw.tier || 'unknown',
                  actorEmail: 'admin@bitsio.com',
                  actionNote: `Quick-win approved: ${qw.action} — estimated savings ${fmt$(qw.savings)}`,
                  idempotencyKey: `quickwin-approve-${qw.indexName}-${qw.action}-${Date.now()}`,
                }),
              });
              setApprovedWins(prev => { const n = new Set(Array.from(prev)); n.add(key); return n; });
            } catch { /* silently ignore */ }
            finally { setApprovingWin(null); }
          };

          const approveAll = async () => {
            const pending = wins.filter(qw => !approvedWins.has(`${qw.indexName}::${qw.action}`));
            for (const qw of pending) { await approveWin(qw); }
          };

          return (
            <div style={{ ...card(), position: 'relative' }}>
              <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={cardTitle}>Quick Wins</div>
                {wins.length > 1 && approvedWins.size < wins.length && (
                  <button onClick={approveAll} style={{ padding: '0.25rem 0.7rem', background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40', borderRadius: 5, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer' }}>
                    ✓ Approve All
                  </button>
                )}
              </div>
              {wins.length === 0
                ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No quick wins identified</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {wins.map((qw, i) => {
                      const key = `${qw.indexName}::${qw.action}`;
                      const approved = approvedWins.has(key);
                      const approving = approvingWin === key;
                      const color = ACTION_COLORS[qw.action] || '#3b82f6';
                      return (
                        <div key={i} style={{ background: '#0f172a', borderRadius: 6, padding: '0.6rem 0.75rem', border: `1px solid ${approved ? '#22c55e40' : '#1e293b'}`, transition: 'border-color 0.3s' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openDrawer({
                              isOpen: true,
                              metric: 'quick_win',
                              value: qw.savings,
                              title: `Quick Win: ${qw.indexName}`,
                              howCalculated: `Action: ${qw.action}\nTier: ${qw.tier}\nEstimated Savings: ${fmt$(qw.savings)}\n\nFlagged as quick win by LLM: high savings, low risk.`,
                              llmReasoning: qw.reasoning || 'No detailed reasoning provided',
                              evidence: [`Index: ${qw.indexName}`, `Action: ${qw.action}`, `Tier: ${qw.tier}`, `Savings: ${fmt$(qw.savings)}`],
                              confidence: kpis.avgConfidence * 100,
                              action: qw.action,
                              tier: qw.tier,
                              rawData: { indexName: qw.indexName, action: qw.action, tier: qw.tier, savings: qw.savings },
                            })}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>#{i + 1}</span>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qw.indexName}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ padding: '0.1rem 0.35rem', borderRadius: 3, fontSize: '0.62rem', background: `${color}20`, color, fontWeight: 600 }}>{qw.action}</span>
                                {qw.tier && <span style={{ fontSize: '0.62rem', color: '#475569' }}>{qw.tier}</span>}
                                <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 700, marginLeft: 'auto' }}>{qw.savings > 0 ? fmt$(qw.savings) : '—'}</span>
                              </div>
                              {qw.reasoning && (
                                <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {qw.reasoning.slice(0, 90)}{qw.reasoning.length > 90 ? '…' : ''}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => approveWin(qw)}
                              disabled={approved || approving}
                              style={{
                                flexShrink: 0,
                                padding: '0.3rem 0.65rem',
                                borderRadius: 5,
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                cursor: approved ? 'default' : 'pointer',
                                border: 'none',
                                background: approved ? '#22c55e20' : approving ? '#1e293b' : '#22c55e',
                                color: approved ? '#22c55e' : approving ? '#64748b' : '#0f172a',
                                transition: 'all 0.2s',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {approved ? '✓ Approved' : approving ? '…' : '✓ Approve'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {approvedWins.size > 0 && (
                      <div style={{ fontSize: '0.7rem', color: '#22c55e', textAlign: 'center', marginTop: 2 }}>
                        {approvedWins.size} quick win{approvedWins.size > 1 ? 's' : ''} approved this session
                      </div>
                    )}
                  </div>
                )
              }
            </div>
          );
        })()}
      </div>

      {/* Row 5 — D11 Utilization×Detection Scatter + D8 Top Indexes by Volume */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* D11: Utilization × Detection Quadrant */}
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
                        <g key={i} style={{ cursor: 'pointer' }} onClick={() => openDrawer({
                          isOpen: true,
                          metric: 'scatter_bubble',
                          value: `U:${s.utilizationScore.toFixed(0)}% D:${s.detectionScore.toFixed(0)}%`,
                          title: `Index: ${s.indexName}`,
                          howCalculated: `Utilization Score: ${s.utilizationScore.toFixed(0)}%\nDetection Score: ${s.detectionScore.toFixed(0)}%\nDaily Ingest: ${fmtGB(s.dailyAvgGb)}\nTier: ${s.tier}\nAction: ${s.action}`,
                          llmReasoning: agentReasoning,
                          evidence: [
                            `Index: ${s.indexName}`,
                            `Tier: ${s.tier}`,
                            `Utilization: ${s.utilizationScore.toFixed(0)}%`,
                            `Detection: ${s.detectionScore.toFixed(0)}%`,
                            `Daily Volume: ${fmtGB(s.dailyAvgGb)}`,
                            `Quality Score: ${s.qualityScore.toFixed(0)}%`,
                            `Recommended Action: ${s.action}`,
                          ],
                          confidence: kpis.avgConfidence * 100,
                          tier: s.tier,
                          action: s.action,
                          rawData: {
                            indexName: s.indexName,
                            tier: s.tier,
                            action: s.action,
                            utilizationScore: s.utilizationScore,
                            detectionScore: s.detectionScore,
                            qualityScore: s.qualityScore,
                            dailyAvgGb: s.dailyAvgGb,
                            costPerYear: s.costPerYear,
                          },
                        })}>
                          <circle cx={mapX(s.utilizationScore)} cy={mapY(s.detectionScore)}
                            r={bR} fill={col} fillOpacity={0.65} stroke={col} strokeWidth={1} strokeOpacity={0.9} />
                          <title>{s.indexName}: Util={s.utilizationScore.toFixed(0)}, Det={s.detectionScore.toFixed(0)}, {fmtGB(s.dailyAvgGb)}/day (click for details)</title>
                        </g>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
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
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
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
        <div style={{ ...card(), borderLeft: '4px solid #3b82f6', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={cardTitle}>🧠 Agent Reasoning</div>
          <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{agentReasoning}</p>
        </div>
      )}

      {/* Reasoning Drawer */}
      <ReasoningDrawer
        isOpen={drawer.isOpen}
        onClose={() => setDrawer({ ...drawer, isOpen: false })}
        metric={drawer.metric}
        value={drawer.value}
        title={drawer.title}
        howCalculated={drawer.howCalculated}
        llmReasoning={drawer.llmReasoning}
        evidence={drawer.evidence}
        confidence={drawer.confidence}
        tier={drawer.tier}
        action={drawer.action}
        candidateReason={drawer.candidateReason}
        rawData={drawer.rawData}
      />
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
