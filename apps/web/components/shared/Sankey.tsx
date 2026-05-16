'use client';

import React, { useMemo, useState } from 'react';

interface SankeyNode {
  tier: string;
  action: string;
  count: number;
  savings: number;
  color?: string;
}

interface Props {
  data: SankeyNode[];
  title?: string;
  width?: string;
  height?: number;
}

const TIER_COLORS: Record<string, string> = {
  CRITICAL: '#3b82f6',
  IMPORTANT: '#10b981',
  NICE_TO_HAVE: '#f59e0b',
  LOW_VALUE: '#ef4444',
};

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#3b82f6',
  OPTIMIZE: '#8b5cf6',
  ARCHIVE: '#f59e0b',
  ELIMINATE: '#ef4444',
  S3_CANDIDATE: '#06b6d4',
};

export default function Sankey({ data, title = 'Tier → Action → Savings Flow', width = '100%', height = 450 }: Props) {
  const [selectedFlow, setSelectedFlow] = useState<number | null>(null);
  const svgWidth = 900;
  const svgHeight = height || 450;
  const margin = { left: 60, right: 120, top: 30, bottom: 30 };

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(item => {
      counts[item.tier] = (counts[item.tier] || 0) + item.count;
    });
    return counts;
  }, [data]);

  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(item => {
      counts[item.action] = (counts[item.action] || 0) + item.count;
    });
    return counts;
  }, [data]);

  const totalSavings = useMemo(() => {
    return data.reduce((sum, item) => sum + item.savings, 0);
  }, [data]);

  const maxCount = Math.max(
    ...Object.values(tierCounts),
    ...Object.values(actionCounts),
    1
  );

  const tierOrder = ['CRITICAL', 'IMPORTANT', 'NICE_TO_HAVE', 'LOW_VALUE'];
  const actionOrder = ['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'S3_CANDIDATE'];

  const col1X = margin.left;
  const col2X = col1X + (svgWidth - margin.left - margin.right) / 2;
  const col3X = svgWidth - margin.right;

  const getTierY = (tier: string): number => {
    const index = tierOrder.indexOf(tier);
    const count = tierCounts[tier] || 0;
    const height = (count / maxCount) * (svgHeight - margin.top - margin.bottom);
    const totalHeight = tierOrder.reduce((sum, t) => sum + ((tierCounts[t] || 0) / maxCount) * (svgHeight - margin.top - margin.bottom), 0);
    let accum = margin.top;
    for (let i = 0; i < index; i++) {
      accum += ((tierCounts[tierOrder[i]] || 0) / maxCount) * (svgHeight - margin.top - margin.bottom);
    }
    return accum + height / 2;
  };

  const getActionY = (action: string): number => {
    const index = actionOrder.indexOf(action);
    const count = actionCounts[action] || 0;
    const height = (count / maxCount) * (svgHeight - margin.top - margin.bottom);
    let accum = margin.top;
    for (let i = 0; i < index; i++) {
      accum += ((actionCounts[actionOrder[i]] || 0) / maxCount) * (svgHeight - margin.top - margin.bottom);
    }
    return accum + height / 2;
  };

  const getTierHeight = (tier: string): number => {
    const count = tierCounts[tier] || 0;
    return (count / maxCount) * (svgHeight - margin.top - margin.bottom);
  };

  const getActionHeight = (action: string): number => {
    const count = actionCounts[action] || 0;
    return (count / maxCount) * (svgHeight - margin.top - margin.bottom);
  };

  const bezierPath = (x1: number, y1: number, x2: number, y2: number): string => {
    const cp1x = x1 + (x2 - x1) / 3;
    const cp2x = x1 + (x2 - x1) * 2 / 3;
    return `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div style={{ width, padding: '1.5rem', background: '#1e293b', borderRadius: 12 }}>
      {title && <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 600 }}>{title}</h3>}

      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minWidth: svgWidth, height: 'auto', background: '#0f172a', borderRadius: 8 }}>
          {/* Column 1: Tier distribution */}
          {tierOrder.map((tier) => {
            const count = tierCounts[tier] || 0;
            if (count === 0) return null;
            const y = getTierY(tier);
            const h = getTierHeight(tier);
            return (
              <g key={`tier-${tier}`}>
                <rect
                  x={col1X - 40}
                  y={y - h / 2}
                  width={80}
                  height={h}
                  fill={TIER_COLORS[tier]}
                  opacity={0.8}
                  stroke="#334155"
                  strokeWidth={1}
                />
                <text
                  x={col1X}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 11, fontWeight: 600, fill: '#f8fafc' }}
                >
                  {tier.replace('_', ' ')}
                </text>
                <text
                  x={col1X}
                  y={y + 14}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 9, fill: '#cbd5e1' }}
                >
                  {count}
                </text>
              </g>
            );
          })}

          {/* Column 2: Actions with flows */}
          {actionOrder.map((action) => {
            const count = actionCounts[action] || 0;
            if (count === 0) return null;
            const y = getActionY(action);
            const h = getActionHeight(action);
            return (
              <g key={`action-${action}`}>
                <rect
                  x={col2X - 40}
                  y={y - h / 2}
                  width={80}
                  height={h}
                  fill={ACTION_COLORS[action]}
                  opacity={0.8}
                  stroke="#334155"
                  strokeWidth={1}
                />
                <text
                  x={col2X}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 11, fontWeight: 600, fill: '#f8fafc' }}
                >
                  {action}
                </text>
                <text
                  x={col2X}
                  y={y + 14}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 9, fill: '#cbd5e1' }}
                >
                  {count}
                </text>
              </g>
            );
          })}

          {/* Flows from tier to action */}
          {data.map((item, idx) => {
            const y1 = getTierY(item.tier);
            const y2 = getActionY(item.action);
            const isSelected = selectedFlow === idx;
            const opacity = isSelected ? 0.9 : Math.max(0.2, Math.min(0.6, item.count / maxCount));
            const strokeWidth = isSelected ? 3 : 2;
            return (
              <path
                key={`flow-${idx}`}
                d={bezierPath(col1X + 40, y1, col2X - 40, y2)}
                stroke={isSelected ? '#06b6d4' : '#64748b'}
                strokeWidth={strokeWidth}
                fill="none"
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={() => setSelectedFlow(isSelected ? null : idx)}
              />
            );
          })}

          {/* Column 3: Savings impact */}
          <g>
            {/* Total savings box */}
            <rect
              x={col3X - 55}
              y={margin.top}
              width={110}
              height={80}
              fill="rgba(34, 197, 94, 0.1)"
              stroke="#22c55e"
              strokeWidth={2}
              borderRadius={4}
            />
            <text
              x={col3X}
              y={margin.top + 20}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
            >
              TOTAL SAVINGS
            </text>
            <text
              x={col3X}
              y={margin.top + 50}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontSize: 18, fontWeight: 700, fill: '#22c55e' }}
            >
              ${(totalSavings / 1000).toFixed(1)}k
            </text>
          </g>

          {/* Label column 3 */}
          <text
            x={col3X}
            y={margin.top - 10}
            textAnchor="middle"
            dominantBaseline="end"
            style={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
          >
            Annual Impact
          </text>
        </svg>
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', fontSize: '0.8125rem' }}>
        <div style={{ padding: '0.75rem', background: '#0f172a', borderRadius: 6 }}>
          <div style={{ color: '#64748b', marginBottom: '0.25rem' }}>Total Indexes</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
            {data.reduce((sum, item) => sum + item.count, 0)}
          </div>
        </div>
        <div style={{ padding: '0.75rem', background: '#0f172a', borderRadius: 6 }}>
          <div style={{ color: '#64748b', marginBottom: '0.25rem' }}>For Review</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700', color: '#f59e0b' }}>
            {data.filter(d => d.action !== 'KEEP').reduce((sum, d) => sum + d.count, 0)}
          </div>
        </div>
        <div style={{ padding: '0.75rem', background: '#0f172a', borderRadius: 6 }}>
          <div style={{ color: '#64748b', marginBottom: '0.25rem' }}>Potential Savings</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>
            ${(totalSavings / 1000).toFixed(1)}k/yr
          </div>
        </div>
      </div>

      {selectedFlow !== null && data[selectedFlow] && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#0f172a', borderRadius: 8, border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.9375rem', fontWeight: 600 }}>
              {data[selectedFlow].tier.replace('_', ' ')} → {data[selectedFlow].action}
            </h4>
            <button
              onClick={() => setSelectedFlow(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '1.25rem',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Indexes in transition</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#06b6d4' }}>{data[selectedFlow].count}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Annual savings</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>
                ${(data[selectedFlow].savings / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#cbd5e1' }}>
            {data[selectedFlow].count} {data[selectedFlow].count === 1 ? 'index' : 'indexes'} classified as {data[selectedFlow].tier.toLowerCase().replace('_', ' ')} will be {data[selectedFlow].action.toLowerCase()}, generating ${(data[selectedFlow].savings / 1000).toFixed(1)}k in annual savings.
          </div>
        </div>
      )}
    </div>
  );
}
