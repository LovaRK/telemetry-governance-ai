'use client';

/**
 * KPI Gauges — pure visualization components.
 * These components NEVER fetch data. They receive all values as props.
 * Data is fetched in Server Components and passed down via props.
 */

import React from 'react';

// ─────────────────────────────────────────────
// Gauge (semicircular KPI dial)
// ─────────────────────────────────────────────

interface GaugeProps {
  value: number;
  max?: number;
  label: string;
  color: string;
  onClick?: () => void;
}

export function Gauge({ value, max = 100, label, color, onClick }: GaugeProps) {
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
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default'
      }}
      onClick={onClick}
    >
      <svg width={160} height={95} viewBox="0 0 160 95">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#1e293b" strokeWidth={14} strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"
          />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f8fafc" fontSize={22} fontWeight={700}>
          {Number.isFinite(value) ? value.toFixed(0) : '--'}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#64748b" fontSize={10}>/ {max}</text>
      </svg>
      <div style={{
        fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase',
        letterSpacing: '0.06em', marginTop: -4
      }}>
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MiniGauge (compact semicircle)
// ─────────────────────────────────────────────

interface MiniGaugeProps {
  value: number;
  max: number;
  label: string;
  color: string;
}

export function MiniGauge({ value, max, label, color }: MiniGaugeProps) {
  const pct = Math.min(value / max, 1);
  const angle = pct * 180;
  const r = 26, cx = 36, cy = 34;

  const polarToXY = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const end = polarToXY(angle);
  const largeArc = angle > 90 ? 1 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={72} height={52} viewBox="0 0 72 52" style={{ overflow: 'hidden' }}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#1e293b" strokeWidth={8} strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
          />
        )}
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#f8fafc" fontSize={14} fontWeight={700}>
          {Number.isFinite(value) ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--'}
        </text>
      </svg>
      <div style={{
        fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginTop: 0, textAlign: 'center'
      }}>
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SpendGauge (cost dial with % of total label)
// ─────────────────────────────────────────────

interface SpendGaugeProps {
  amount: number;
  total: number;
  label: string;
  color: string;
}

export function SpendGauge({ amount, total, label, color }: SpendGaugeProps) {
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

  // Inline fmt$ to keep this component self-contained
  const fmt = (v: number) => {
    if (!isFinite(v)) return '$0';
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={160} height={95} viewBox="0 0 160 95">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#1e293b" strokeWidth={14} strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"
          />
        )}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#f8fafc" fontSize={17} fontWeight={700}>
          {fmt(amount)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize={9}>{pctLabel}</text>
      </svg>
      <div style={{
        fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase',
        letterSpacing: '0.06em', marginTop: -4
      }}>
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ScoreBar (horizontal progress bar)
// ─────────────────────────────────────────────

interface ScoreBarProps {
  label: string;
  value: number;
  color: string;
}

export function ScoreBar({ label, value, color }: ScoreBarProps) {
  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem'
      }}>
        <span>{label}</span>
        <span style={{ color: '#f8fafc', fontWeight: 600 }}>
          {Number.isFinite(value) ? `${value.toFixed(0)}%` : '--%'}
        </span>
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.min(value, 100)}%`,
          background: color, borderRadius: 3
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DonutChart (multi-segment ring chart)
// ─────────────────────────────────────────────

interface DonutChartProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({ segments, size = 140, strokeWidth = 22 }: DonutChartProps) {
  const r = (size - strokeWidth) / 2 - 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, v) => s + v.value, 0);

  if (total === 0) {
    return (
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#475569" fontSize={11}>No data</text>
      </svg>
    );
  }

  let cumLen = 0;
  const arcs = segments.map((seg) => {
    const segLen = (seg.value / total) * circ;
    const off = cumLen;
    cumLen += segLen;
    return { ...seg, segLen, off };
  });

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      {arcs.map((arc, i) =>
        arc.segLen > 0 ? (
          <circle
            key={i} cx={cx} cy={cy} r={r} fill="none" stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.segLen} ${circ - arc.segLen}`}
            strokeDashoffset={-arc.off}
          />
        ) : null
      )}
    </svg>
  );
}
