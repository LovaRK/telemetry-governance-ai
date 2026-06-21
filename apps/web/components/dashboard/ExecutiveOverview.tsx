'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ExecutiveSummary } from '../../lib/types';
import ReasoningDrawer from '../shared/ReasoningDrawer';
import KPITrendChart from '../KPITrendChart';
import FormulaBreakdownModal from '../shared/FormulaBreakdownModal';
import ProvenanceBadge from '../shared/ProvenanceBadge';
import BaselineBadge from '../shared/BaselineBadge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { fmt$ } from './executive-overview/utils';

function getActorEmail(): string {
  if (typeof window === 'undefined') return 'system';
  try {
    const ctx = JSON.parse(localStorage.getItem('auth_context') || '{}');
    if (ctx.email) return ctx.email;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.email) return user.email;
  } catch { /* ignore */ }
  return 'system';
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
  const largeArc = 0; // always short arc — semicircle gauge never exceeds 180°
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <svg width={160} height={95} viewBox="0 0 160 95" style={{ opacity: onClick ? 1 : 1, transition: 'opacity 0.2s' }}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={14} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f8fafc" fontSize={22} fontWeight={700}>{Number.isFinite(value) ? value.toFixed(0) : '--'}</text>
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
        <span>{label}</span><span style={{ color: '#f8fafc', fontWeight: 600 }}>{Number.isFinite(value) ? `${value.toFixed(0)}%` : '--%'}</span>
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function StaircaseBarChart({ chartData, stageColors, openDrawer, agentReasoning, avgConfidencePct, totalSaved }: {
  chartData: Array<{ label: string; action: string; spend: number; savings: number; cumulative: number; index: number }>;
  stageColors: Record<string, string>;
  openDrawer: (d: any) => void;
  agentReasoning: string;
  avgConfidencePct: number | null;
  totalSaved: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setChartWidth(Math.floor(w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) measure();
    }, { threshold: 0.1 });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  const maxSpend = Math.max(...chartData.map(d => d.spend), 1);
  const svgH = 170;
  const padTop = 8;
  const padBot = 28;
  const padLeft = 50;
  const padRight = 8;
  const barAreaH = svgH - padTop - padBot;
  const barAreaW = chartWidth - padLeft - padRight;
  const barCount = chartData.length || 1;
  const gap = 6;
  const barW = Math.max((barAreaW - gap * (barCount - 1)) / barCount, 4);

  const handleBarClick = (step: typeof chartData[0]) => {
    openDrawer({
      isOpen: true,
      metric: `${step.action.toLowerCase()}_savings`,
      value: step.spend,
      title: `${step.label}: ${fmt$(step.spend)}`,
      howCalculated: `${step.label}\n\nRemaining spend: ${fmt$(step.spend)}\nPhase savings: ${fmt$(step.savings)}\nCumulative savings: ${fmt$(step.cumulative)}`,
      llmReasoning: agentReasoning,
      evidence: [
        `Remaining spend at this stage: ${fmt$(step.spend)}`,
        `Phase savings: ${fmt$(step.savings)}`,
        `Cumulative savings: ${fmt$(step.cumulative)}`,
      ],
      confidence: avgConfidencePct ?? undefined,
      action: step.action,
      rawData: step,
    });
  };

  const yTicks = [0, Math.round(maxSpend / 2), Math.round(maxSpend)];

  return (
    <div ref={containerRef} style={{ overflow: 'hidden', width: '100%' }}>
      {chartWidth > 0 && (
        <svg width={chartWidth} height={svgH} style={{ cursor: 'pointer', display: 'block', maxWidth: '100%' }}>
          {yTicks.map((t) => {
            const y = padTop + barAreaH - (t / maxSpend) * barAreaH;
            return (
              <g key={t}>
                <line x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} stroke="#1e293b" strokeDasharray="3 3" />
                <text x={padLeft - 4} y={y + 3} textAnchor="end" fill="#64748b" fontSize={10}>{fmt$(t)}</text>
              </g>
            );
          })}
          {chartData.map((entry, i) => {
            const h = (entry.spend / maxSpend) * barAreaH;
            const x = padLeft + i * (barW + gap);
            const y = padTop + barAreaH - h;
            const fill = stageColors[entry.action] || '#3b82f6';
            return (
              <g key={i} onClick={() => handleBarClick(entry)}>
                <rect x={x} y={y} width={barW} height={h} rx={3} ry={3} fill={fill} fillOpacity={0.85} />
                <title>{`${entry.label}: ${fmt$(entry.spend)}`}</title>
                <text x={x + barW / 2} y={svgH - padBot + 14} textAnchor="middle" fill="#64748b" fontSize={9}>
                  {entry.label.length > 10 ? entry.label.slice(0, 10) + '…' : entry.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
        {chartData.filter(s => s.savings > 0).map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: stageColors[step.action] || '#3b82f6' }} />
            <span style={{ color: '#64748b' }}>{step.label}</span>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>−{fmt$(step.savings)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#22c55e' }} />
          <span style={{ color: '#64748b' }}>Total saved</span>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt$(totalSaved)}</span>
        </div>
      </div>
    </div>
  );
}

function MiniGauge({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(value / max, 1);
  const angle = pct * 180;
  const r = 26, cx = 36, cy = 34;
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const end = polarToXY(angle);
  const largeArc = 0; // always short arc — semicircle gauge never exceeds 180°
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={72} height={52} viewBox="0 0 72 52" style={{ overflow: 'hidden' }}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={8} strokeLinecap="round" />
        {pct > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />}
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#f8fafc" fontSize={14} fontWeight={700}>{Number.isFinite(value) ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--'}</text>
      </svg>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 0, textAlign: 'center' }}>{label}</div>
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
  const largeArc = 0; // always short arc — semicircle gauge never exceeds 180°
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
  snapshotId?: string;
  runId?: string;
  computedAt?: string;
}

export default function ExecutiveOverview({ summary, hasAgentDecisions = false, explainabilityEnabled = false }: Props) {
  const { kpis, quickWins = [], savingsStaircase = [], agentReasoning = '', snapshotDate, snapshots = [] } = summary;
  const avgConfidencePct = kpis.avgConfidence !== null
    ? (kpis.avgConfidence <= 1 ? kpis.avgConfidence * 100 : kpis.avgConfidence)
    : null;
  const roiScore = kpis.roiScore ?? 0;
  const gainScopeScore = kpis.gainScopeScore ?? 0;
  const totalLicenseSpend = kpis.totalLicenseSpend ?? 0;
  const storageSavingsPotential = kpis.storageSavingsPotential ?? 0;
  const licenseSpendLowValue = kpis.licenseSpendLowValue ?? 0;
  const avgUtilization = kpis.avgUtilization ?? 0;
  const avgDetection = kpis.avgDetection ?? 0;
  const avgQuality = kpis.avgQuality ?? 0;
  const [drawer, setDrawer] = useState<DrawerState>({ isOpen: false, metric: '', value: '', title: '', howCalculated: '' });
  const openDrawer = (next: DrawerState): void => {
    if (!explainabilityEnabled) return;
    setDrawer({ ...next, snapshotId: next.snapshotId || summary.snapshotId, runId: next.runId || summary.runId, computedAt: next.computedAt || snapshotDate });
  };

  // Formula modal states for transparency
  const [openFormulaModal, setOpenFormulaModal] = useState<string | null>(null);

  const tierTotal = kpis.tierCounts.critical + kpis.tierCounts.important + kpis.tierCounts.niceToHave + kpis.tierCounts.lowValue;
  const tierBars = [
    { label: 'Critical', key: 'critical', value: kpis.tierCounts.critical, color: TIER_COLORS.critical },
    { label: 'Important', key: 'important', value: kpis.tierCounts.important, color: TIER_COLORS.important },
    { label: 'Nice-to-Have', key: 'niceToHave', value: kpis.tierCounts.niceToHave, color: TIER_COLORS.niceToHave },
    { label: 'Low Value', key: 'lowValue', value: kpis.tierCounts.lowValue, color: TIER_COLORS.lowValue },
  ];

  const actionCounts: Record<string, number> = {};
  snapshots.forEach((s) => { actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1; });

  const staircase: Array<{ label: string; action: string; savings: number; cumulative: number; spend: number }> =
    savingsStaircase && savingsStaircase.length > 0
      ? savingsStaircase
      : [];
  const staircaseHasDelta = staircase.length > 1 && staircase[0]?.spend > staircase[staircase.length - 1]?.spend;

  // D7: Score profile by tier — use kpis.tierCounts for counts (authoritative), snapshots for averages
  const tierCountsMap: Record<string, number> = {
    Critical: kpis.tierCounts.critical, Important: kpis.tierCounts.important,
    'Nice-to-Have': kpis.tierCounts.niceToHave, 'Low Value': kpis.tierCounts.lowValue,
  };
  const tierGroups = [
    { label: 'Critical', match: /critical/i },
    { label: 'Important', match: /important/i },
    { label: 'Nice-to-Have', match: /nice/i },
    { label: 'Low Value', match: /low.value/i },
  ].map(({ label, match }) => {
    const inTier = snapshots.filter(s => match.test(s.tier));
    const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return {
      label, count: tierCountsMap[label] ?? inTier.length, color: tierColor(label),
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
          <div style={{ textAlign: 'center', padding: '0.5rem 0.75rem', background: '#1e1b4b20', border: '1px solid #4f46e520', borderRadius: 6 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: kpis.securityGaps > 0 ? '#ef4444' : '#a78bfa' }}>{kpis.securityGaps}</div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Sec. Gaps</div>
          </div>
          <div style={{ textAlign: 'center', padding: '0.5rem 0.75rem', background: '#1e1b4b20', border: '1px solid #4f46e520', borderRadius: 6 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: kpis.operationalGaps > 0 ? '#f59e0b' : '#a78bfa' }}>{kpis.operationalGaps}</div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.25rem' }}>Ops Gaps</div>
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
      <div style={{ display: hasAgentDecisions ? 'grid' : 'none', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'center' }}>
            ROI Score
            <button
              onClick={() => setOpenFormulaModal('roi_score')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0 0.25rem',
              }}
              title="View formula"
            >
              ⓘ
            </button>
          </div>
          <Gauge
            value={roiScore}
            label=""
            color="#22c55e"
            onClick={() => openDrawer({
              isOpen: true,
              metric: 'roi_score',
              value: roiScore,
              title: `ROI Score: ${roiScore.toFixed(0)}`,
              howCalculated: `ROI Score = avg(composite_score) across all sourcetypes\n\nComposite = (0.35 × utilization) + (0.40 × detection) + (0.25 × quality)\n\nTier distribution:\n  Critical: ${kpis.tierCounts.critical}\n  Important: ${kpis.tierCounts.important}\n  Nice-to-Have: ${kpis.tierCounts.niceToHave}\n  Low Value: ${kpis.tierCounts.lowValue}`,
              llmReasoning: agentReasoning,
              evidence: [
                `Savings potential: ${fmt$(storageSavingsPotential)}`,
                `Current annual spend: ${fmt$(totalLicenseSpend)}`,
                `${kpis.tierCounts.lowValue} low-value indexes identified`,
                `${kpis.tierCounts.critical + kpis.tierCounts.important} high-value indexes protected`,
              ],
              confidence: avgConfidencePct ?? undefined,
              rawData: {
                tierCounts: kpis.tierCounts,
                roiScore: kpis.roiScore,
                storageSavingsPotential: kpis.storageSavingsPotential,
                totalLicenseSpend: kpis.totalLicenseSpend,
              },
            })}
          />
          <ProvenanceBadge
            source="executive_kpis"
            generatedAt={snapshotDate}
            pipelineRunId={summary.runId}
            classification="REAL"
          />
          <FormulaBreakdownModal
            isOpen={openFormulaModal === 'roi_score'}
            metricName="ROI Score"
            formula="avg(composite_score) across all sourcetypes"
            components={[
              { label: 'Savings Potential', value: fmt$(storageSavingsPotential) },
              { label: 'Annual Spend', value: fmt$(totalLicenseSpend) },
              { label: 'Critical Indexes', value: kpis.tierCounts.critical, weight: '35%' },
              { label: 'Important Indexes', value: kpis.tierCounts.important, weight: '40%' },
            ]}
            result={roiScore.toFixed(1)}
            unit="%"
            onClose={() => setOpenFormulaModal(null)}
          />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'center' }}>
            GainScope
            <button
              onClick={() => setOpenFormulaModal('gainscope')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0 0.25rem',
              }}
              title="View formula"
            >
              ⓘ
            </button>
          </div>
          <Gauge
            value={gainScopeScore}
            label=""
            color="#3b82f6"
            onClick={() => openDrawer({
              isOpen: true,
              metric: 'gainscope_score',
              value: gainScopeScore,
              title: `GainScope Score: ${gainScopeScore.toFixed(0)}`,
              howCalculated: `GainScope Score = (Tier 1+2 total GB / Total daily GB) × 100\n\nTier 1 (Critical) + Tier 2 (Important) GB contributes to the numerator.\nAll ingested data (GB/day) is the denominator.\n\nScore: ${gainScopeScore.toFixed(1)}% of daily volume is high-value data.\nTotal daily ingest: ${fmtGB(kpis.totalDailyGb)}`,
              llmReasoning: agentReasoning,
              evidence: [
                `Average utilization score: ${avgUtilization.toFixed(0)}%`,
                `Average detection coverage: ${avgDetection.toFixed(0)}%`,
                `Average data quality: ${avgQuality.toFixed(0)}%`,
                `${kpis.totalSourcetypes} indexes analyzed`,
              ],
              confidence: avgConfidencePct ?? undefined,
              rawData: {
                gainScopeScore: kpis.gainScopeScore,
                avgUtilization: kpis.avgUtilization,
                avgDetection: kpis.avgDetection,
                avgQuality: kpis.avgQuality,
              },
            })}
          />
          <ProvenanceBadge
            source="executive_kpis"
            generatedAt={snapshotDate}
            pipelineRunId={summary.runId}
            classification="REAL"
          />
          <FormulaBreakdownModal
            isOpen={openFormulaModal === 'gainscope'}
            metricName="GainScope %"
            formula="(Tier 1+2 total GB/day / Total daily GB) × 100"
            components={[
              { label: 'Tier 1+2 (Critical + Important) GB/day', value: fmtGB(snapshots.filter(s => /critical|important/i.test(s.tier)).reduce((sum, s) => sum + s.dailyAvgGb, 0)) },
              { label: 'Total Daily Ingest', value: fmtGB(kpis.totalDailyGb) },
            ]}
            result={gainScopeScore.toFixed(1)}
            unit="%"
            onClose={() => setOpenFormulaModal(null)}
          />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'center' }}>
            Low-Value Spend
            <button
              onClick={() => setOpenFormulaModal('low_value_spend')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0 0.25rem',
              }}
              title="View formula"
            >
              ⓘ
            </button>
          </div>
          <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
            isOpen: true,
            metric: 'license_spend_low_value',
            value: licenseSpendLowValue,
            title: `Low-Value Spend: ${fmt$(licenseSpendLowValue)}`,
            howCalculated: `Low-Value Spend = Annual cost of Tier 3 (Nice-to-Have) + Tier 4 (Low-Value) indexes\n\nNice-to-Have indexes: ${kpis.tierCounts.niceToHave}\nLow-Value indexes: ${kpis.tierCounts.lowValue}\nCombined Tier 3+4 annual cost: ${fmt$(licenseSpendLowValue)}\nTotal annual spend: ${fmt$(totalLicenseSpend)}\nPercentage: ${totalLicenseSpend > 0 ? ((licenseSpendLowValue / totalLicenseSpend) * 100).toFixed(1) : 0}%`,
            llmReasoning: agentReasoning,
            evidence: [
              `${kpis.tierCounts.niceToHave} Nice-to-Have + ${kpis.tierCounts.lowValue} Low-Value indexes (Tier 3+4)`,
              `Annual cost: ${fmt$(licenseSpendLowValue)}`,
              `Potential savings: ${fmt$(storageSavingsPotential)}`,
              `Recommended action: Archive or eliminate low-utilization indexes`,
            ],
            confidence: avgConfidencePct ?? undefined,
            rawData: {
              licenseSpendLowValue: kpis.licenseSpendLowValue,
              lowValueCount: kpis.tierCounts.lowValue,
              totalLicenseSpend: kpis.totalLicenseSpend,
            },
          })}>
            <SpendGauge amount={licenseSpendLowValue} total={totalLicenseSpend} label="" color="#ef4444" />
          </div>
          <ProvenanceBadge
            source="executive_kpis"
            generatedAt={snapshotDate}
            pipelineRunId={summary.runId}
            classification="REAL"
          />
          <FormulaBreakdownModal
            isOpen={openFormulaModal === 'low_value_spend'}
            metricName="Low-Value Annual Spend"
            formula="SUM(cost_per_year) WHERE tier IN ('Nice-to-Have', 'Low-Value')"
            components={[
              { label: 'Nice-to-Have (Tier 3)', value: kpis.tierCounts.niceToHave },
              { label: 'Low-Value (Tier 4)', value: kpis.tierCounts.lowValue },
              { label: 'Total Annual Spend', value: fmt$(totalLicenseSpend) },
            ]}
            result={fmt$(licenseSpendLowValue)}
            unit=""
            onClose={() => setOpenFormulaModal(null)}
          />
        </div>
        <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>🤖 AI</div>
          <div style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'center' }}>
            Savings Potential
            <button
              onClick={() => setOpenFormulaModal('savings_potential')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0 0.25rem',
              }}
              title="View formula"
            >
              ⓘ
            </button>
          </div>
          <div style={{ cursor: 'pointer' }} onClick={() => openDrawer({
            isOpen: true,
            metric: 'storage_savings_potential',
            value: storageSavingsPotential,
            title: `Savings Potential: ${fmt$(storageSavingsPotential)}`,
            howCalculated: `Storage Savings Potential (guide §8):\n= Σ per index (retention_excess_gb + compression_opportunity_gb) × storage_cost × months\n\nRetention excess: data stored beyond recommended max retention (365 days)\nCompression: low-utilization data eligible for compression (30% factor)\nField savings: requires TA lookup (not yet wired)\n\nTotal: ${fmt$(storageSavingsPotential)}\n(${totalLicenseSpend > 0 ? ((storageSavingsPotential / totalLicenseSpend) * 100).toFixed(1) : 0}% of ${fmt$(totalLicenseSpend)} annual spend)`,
            llmReasoning: agentReasoning,
            evidence: [
              `Estimated annual savings: ${fmt$(storageSavingsPotential)}`,
              `Percentage of current spend: ${totalLicenseSpend > 0 ? ((storageSavingsPotential / totalLicenseSpend) * 100).toFixed(1) : 0}%`,
              `Low-value spend to reduce: ${fmt$(licenseSpendLowValue)}`,
              `${kpis.tierCounts.critical + kpis.tierCounts.important} high-value indexes remain protected`,
            ],
            confidence: avgConfidencePct ?? undefined,
            rawData: {
              storageSavingsPotential: kpis.storageSavingsPotential,
              totalLicenseSpend: kpis.totalLicenseSpend,
              licenseSpendLowValue: kpis.licenseSpendLowValue,
            },
          })}>
            <SpendGauge amount={storageSavingsPotential} total={totalLicenseSpend} label="" color="#22c55e" />
          </div>
          <ProvenanceBadge
            source="executive_kpis"
            generatedAt={snapshotDate}
            pipelineRunId={summary.runId}
            classification="REAL"
          />
          <FormulaBreakdownModal
            isOpen={openFormulaModal === 'savings_potential'}
            metricName="Storage Savings Potential"
            formula="Σ(retention_excess + compression_opportunity) × storage_cost × months per index"
            components={[
              { label: 'Low-Value Spend', value: fmt$(kpis.licenseSpendLowValue) },
              { label: 'Total Annual Spend', value: fmt$(kpis.totalLicenseSpend) },
              { label: 'Potential Savings %', value: totalLicenseSpend > 0 ? ((storageSavingsPotential / totalLicenseSpend) * 100).toFixed(1) : '0', weight: '100%' },
            ]}
            result={fmt$(storageSavingsPotential)}
            unit=""
            onClose={() => setOpenFormulaModal(null)}
          />
        </div>
        <div style={{ ...card({ borderLeft: '4px solid #8b5cf6' }), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
          <div style={cardTitle}>Daily Ingest</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>{fmtGB(kpis.totalDailyGb)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{kpis.totalSourcetypes} sourcetypes</div>
        </div>
        {/* UNIMPLEMENTED: Coverage Gaps card hidden */}
        {/* Security Gaps and Operational Gaps are not yet calculated by the LLM */}
        {/* Hidden until the LLM agent is configured to calculate these metrics */}
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
                            `Confidence: ${(avgConfidencePct ?? 0).toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: avgConfidencePct ?? undefined,
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
                            `Confidence: ${(avgConfidencePct ?? 0).toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: avgConfidencePct ?? undefined,
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
                confidence: avgConfidencePct ?? undefined,
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
          <ScoreBar label="Utilization" value={avgUtilization} color="#3b82f6" />
          <ScoreBar label="Detection Coverage" value={avgDetection} color="#8b5cf6" />
          <ScoreBar label="Data Quality" value={avgQuality} color="#22c55e" />
          <ScoreBar label="Confidence" value={avgConfidencePct ?? 0} color="#f59e0b" />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {spendByTier.map((tier, idx) => {
              const tierKey = tier.label.toLowerCase().replace(/ /g, '_');
              return (
                <div key={tier.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: '#94a3b8' }}>{tier.label}</span>
                      <button
                        onClick={() => setOpenFormulaModal(`tier_${idx}_spend`)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          padding: 0,
                        }}
                        title="View formula"
                      >
                        ⓘ
                      </button>
                    </div>
                    <span style={{ color: tier.color, fontWeight: 600 }}>{fmt$(tier.value)}</span>
                  </div>
                  <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${maxTierSpend > 0 ? (tier.value / maxTierSpend) * 100 : 0}%`, background: tier.color, borderRadius: 4, minWidth: tier.value > 0 ? 2 : 0 }} />
                  </div>
                  <ProvenanceBadge
                    source="executive_kpis"
                    generatedAt={snapshotDate}
                    pipelineRunId={summary.runId}
                    classification="REAL"
                  />
                  <FormulaBreakdownModal
                    isOpen={openFormulaModal === `tier_${idx}_spend`}
                    metricName={`${tier.label} Annual Spend`}
                    formula={`SUM(annual_license_cost) WHERE tier = '${tier.label}'`}
                    components={[
                      { label: `${tier.label} Count`, value: kpis.tierCounts[tier.label.toLowerCase().replace(/[^a-z]/g, '') as keyof typeof kpis.tierCounts] || 0 },
                      { label: 'Total Spend', value: fmt$(kpis.totalLicenseSpend) },
                    ]}
                    result={fmt$(tier.value)}
                    unit=""
                    onClose={() => setOpenFormulaModal(null)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 4 — Savings Staircase + Quick Wins */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem', backgroundColor: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>✓ FACT</div>
          <div style={cardTitle}>Savings Staircase</div>
          {staircase.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No savings data yet — run the pipeline first</div>
            : !staircaseHasDelta
            ? (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '0.75rem' }}>
                  {staircase.map((step, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.375rem 0.5rem', background: '#1e293b', borderRadius: 4 }}>
                      <span style={{ color: '#94a3b8' }}>{step.label}</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmt$(step.spend ?? step.cumulative)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic' }}>No cost reduction projected — retention and utilization within guidelines</div>
              </div>
            )
            : (() => {
                const STAGE_COLORS: Record<string, string> = {
                  BASELINE: '#ef4444', COMPRESS: '#f59e0b', RETAIN: '#3b82f6', S3: '#8b5cf6', TARGET: '#22c55e',
                };
                const chartData = staircase.map((step, i) => ({
                  label: step.label,
                  action: step.action,
                  spend: step.spend ?? 0,
                  savings: step.savings,
                  cumulative: step.cumulative,
                  index: i,
                }));
                return (
                  <StaircaseBarChart
                    chartData={chartData}
                    stageColors={STAGE_COLORS}
                    openDrawer={openDrawer}
                    agentReasoning={agentReasoning}
                    avgConfidencePct={avgConfidencePct}
                    totalSaved={staircase[staircase.length - 1]?.cumulative ?? 0}
                  />
                );
              })()
          }
        </div>

        {/* Quick Wins — one-click governance panel */}
        {(() => {
          const [approvedWins, setApprovedWins] = React.useState<Set<string>>(new Set());
          const [approvingWin, setApprovingWin] = React.useState<string | null>(null);

          // Quick Wins = top recommended actions by dollar impact (guide §8).
          // Priority: explicit quickWins → snapshots flagged isQuickWin →
          // deterministic fallback (top savings among actionable, lower-risk tiers).
          const flaggedWins = snapshots.filter(s => s.isQuickWin);
          const fallbackWins = [...snapshots]
            .filter(s =>
              (s.estimatedSavings ?? 0) > 0 &&
              ['ARCHIVE', 'OPTIMIZE', 'ELIMINATE'].includes((s.action || '').toUpperCase()))
            .sort((a, b) => (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0));
          const winsSource = quickWins.length > 0
            ? quickWins.slice(0, 5)
            : (flaggedWins.length > 0 ? flaggedWins : fallbackWins).slice(0, 5).map(s => ({
                indexName: s.indexName, action: s.action,
                savings: s.estimatedSavings ?? 0, tier: s.tier, reasoning: s.reasoning,
              }));
          const wins = winsSource.map(qw => ({
            indexName: qw.indexName, action: qw.action,
            savings: qw.savings, tier: qw.tier, reasoning: qw.reasoning,
          }));

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
                  actorEmail: getActorEmail(),
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
                              confidence: avgConfidencePct ?? undefined,
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
                  <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
                  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'hidden', display: 'block', maxWidth: '100%' }}>
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
                          confidence: avgConfidencePct ?? undefined,
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
                  </div>
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
                {top6ByVol.map((s, i) => {
                  const pct = (s.dailyAvgGb / maxVol) * 100;
                  const col = tierColor(s.tier);
                  return (
                    <div key={`${s.indexName}-${s.sourcetype || ''}-${i}`}>
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
                    <tr key={`${s.indexName}-${s.sourcetype || ''}-${i}`} style={{ borderBottom: '1px solid #0f172a', background: i % 2 ? '#ffffff05' : 'transparent' }}>
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

      {/* Row 7 — Agent Reasoning (Explainability Mode only) */}
      {explainabilityEnabled && agentReasoning && (
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
        llmReasoning={explainabilityEnabled ? drawer.llmReasoning : undefined}
        evidence={explainabilityEnabled ? drawer.evidence : []}
        confidence={explainabilityEnabled ? drawer.confidence : undefined}
        tier={drawer.tier}
        action={drawer.action}
        candidateReason={explainabilityEnabled ? drawer.candidateReason : undefined}
        rawData={drawer.rawData}
        snapshotId={drawer.snapshotId}
        runId={drawer.runId}
        computedAt={drawer.computedAt}
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
