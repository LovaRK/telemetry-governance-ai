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

interface Props {
  summary: ExecutiveSummary;
}

function Gauge({ value, max = 100, label, color }: { value: number; max?: number; label: string; color: string }) {
  const pct = Math.min(value / max, 1);
  const angle = pct * 180;
  const r = 60;
  const cx = 80;
  const cy = 80;

  // Arc math for SVG half-circle gauge
  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = polarToXY(0);
  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={160} height={95} viewBox="0 0 160 95">
        {/* Background track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#1e293b"
          strokeWidth={14}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {pct > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none"
            stroke={color}
            strokeWidth={14}
            strokeLinecap="round"
          />
        )}
        {/* Value text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f8fafc" fontSize={22} fontWeight={700}>
          {value.toFixed(0)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#64748b" fontSize={10}>
          / {max}
        </text>
      </svg>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: -4 }}>
        {label}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
        <span>{label}</span>
        <span style={{ color: '#f8fafc', fontWeight: 600 }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  critical: '#ef4444',
  important: '#f59e0b',
  niceToHave: '#3b82f6',
  lowValue: '#64748b',
};

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6',
};

export default function ExecutiveOverview({ summary }: Props) {
  const { kpis, quickWins, savingsStaircase, agentReasoning, snapshotDate, snapshots } = summary;

  const tierTotal = kpis.tierCounts.critical + kpis.tierCounts.important + kpis.tierCounts.niceToHave + kpis.tierCounts.lowValue;
  const tierBars = [
    { label: 'Critical', key: 'critical', value: kpis.tierCounts.critical, color: TIER_COLORS.critical },
    { label: 'Important', key: 'important', value: kpis.tierCounts.important, color: TIER_COLORS.important },
    { label: 'Nice-to-Have', key: 'niceToHave', value: kpis.tierCounts.niceToHave, color: TIER_COLORS.niceToHave },
    { label: 'Low Value', key: 'lowValue', value: kpis.tierCounts.lowValue, color: TIER_COLORS.lowValue },
  ];

  // Compute action distribution from snapshots
  const actionCounts: Record<string, number> = {};
  snapshots.forEach((s) => { actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1; });

  // Savings staircase: build from savingsStaircase or derive from snapshots
  const staircase = savingsStaircase.length > 0
    ? savingsStaircase
    : (() => {
        const byAction: Record<string, { savings: number; count: number }> = {};
        snapshots.forEach((s) => {
          if (!byAction[s.classification]) byAction[s.classification] = { savings: 0, count: 0 };
          byAction[s.classification].savings += s.estimatedSavings || 0;
          byAction[s.classification].count += 1;
        });
        let cumulative = 0;
        return Object.entries(byAction)
          .filter(([, v]) => v.savings > 0)
          .sort((a, b) => b[1].savings - a[1].savings)
          .map(([action, v]) => {
            cumulative += v.savings;
            return { label: action, savings: v.savings, cumulative, action, count: v.count };
          });
      })();

  const maxStairSavings = staircase.reduce((m, s) => Math.max(m, s.cumulative), 0) || 1;
  const staircaseHasDelta = staircase.some((s) => s.savings > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Row 1 — Gauges + Big KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '1rem' }}>

        {/* ROI Gauge */}
        <div style={{ gridColumn: 'span 1', padding: '1.5rem 1rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>ROI Score</div>
          <Gauge value={kpis.roiScore} label="" color="#22c55e" />
        </div>

        {/* GainScope Gauge */}
        <div style={{ gridColumn: 'span 1', padding: '1.5rem 1rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>GainScope</div>
          <Gauge value={kpis.gainScopeScore} label="" color="#3b82f6" />
        </div>

        {/* Total License Spend */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', borderLeft: '4px solid #ef4444' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Total License Spend</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>
            {fmt$(kpis.totalLicenseSpend)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>annual</div>
        </div>

        {/* Savings Potential */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', borderLeft: '4px solid #22c55e' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Savings Potential</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#22c55e' }}>
            {fmt$(kpis.storageSavingsPotential)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            {kpis.totalLicenseSpend > 0 ? ((kpis.storageSavingsPotential / kpis.totalLicenseSpend) * 100).toFixed(0) : 0}% of spend
          </div>
        </div>

        {/* Daily Ingest */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Daily Ingest</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>
            {fmtGB(kpis.totalDailyGb)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{kpis.totalSourcetypes} sourcetypes</div>
        </div>

        {/* Gaps */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Coverage Gaps</div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>{kpis.securityGaps}</div>
              <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Security</div>
            </div>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>{kpis.operationalGaps}</div>
              <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Operational</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — Tier Distribution + Score Averages + Action Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>

        {/* Tier Distribution */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
            Tier Distribution <span style={{ color: '#334155' }}>— {tierTotal} indexes</span>
          </div>
          {/* Stacked bar */}
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

        {/* Score Averages */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
            Score Averages
          </div>
          <ScoreBar label="Utilization" value={kpis.avgUtilization} color="#3b82f6" />
          <ScoreBar label="Detection Coverage" value={kpis.avgDetection} color="#8b5cf6" />
          <ScoreBar label="Data Quality" value={kpis.avgQuality} color="#22c55e" />
          <ScoreBar label="Confidence" value={kpis.avgConfidence * 100} color="#f59e0b" />
          <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
            Snapshot: {snapshotDate ? new Date(snapshotDate).toLocaleDateString() : '—'}
          </div>
        </div>

        {/* Action Distribution */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
            Agent Actions
          </div>
          {Object.entries(actionCounts).length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No actions yet</div>
            : Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => {
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

      {/* Row 3 — Savings Staircase + Quick Wins */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* Savings Staircase */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1.25rem', fontWeight: 600 }}>
            Savings Staircase
          </div>
          {staircase.length === 0
            ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No savings data yet — run a refresh to generate agent decisions</div>
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
                <div style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic' }}>
                  No cost reduction projected — all tiers at current spend level
                </div>
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
                        <div style={{ height: '100%', width: `${widthPct}%`, background: `${color}30`, borderRadius: 4, transition: 'width 0.4s ease' }} />
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

        {/* Quick Wins */}
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1.25rem', fontWeight: 600 }}>
            Quick Wins
          </div>
          {quickWins.length === 0
            ? (
              <div>
                {snapshots.filter((s) => s.isQuickWin).slice(0, 5).length === 0
                  ? <div style={{ color: '#475569', fontSize: '0.875rem' }}>No quick wins identified</div>
                  : snapshots.filter((s) => s.isQuickWin).slice(0, 5).map((s) => (
                    <QuickWinRow key={s.indexName} indexName={s.indexName} action={s.action} savings={s.estimatedSavings} tier={s.tier} reasoning={s.reasoning} />
                  ))
                }
              </div>
            )
            : quickWins.slice(0, 5).map((qw, i) => (
              <QuickWinRow key={i} {...qw} />
            ))
          }
        </div>
      </div>

      {/* Row 4 — Agent Reasoning */}
      {agentReasoning && (
        <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', fontWeight: 600 }}>
            🧠 Agent Reasoning
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
            {agentReasoning}
          </p>
        </div>
      )}
    </div>
  );
}

function QuickWinRow({ indexName, action, savings, tier, reasoning }: { indexName: string; action: string; savings: number; tier: string; reasoning: string }) {
  return (
    <div style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.875rem' }}>{indexName}</span>
        <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.875rem' }}>{savings > 0 ? fmt$(savings) : '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', background: `${ACTION_COLORS[action] || '#3b82f6'}20`, color: ACTION_COLORS[action] || '#3b82f6', fontWeight: 600 }}>
          {action}
        </span>
        <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', background: '#1e293b', color: '#94a3b8' }}>
          {tier}
        </span>
      </div>
      {reasoning && (
        <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
          {reasoning.slice(0, 120)}{reasoning.length > 120 ? '…' : ''}
        </div>
      )}
    </div>
  );
}
