'use client';

import React, { useState, useMemo, useId } from 'react';

interface DataPoint {
  label: string;
  value: number;
  timestamp?: string;
}

interface LineChartProps {
  data: DataPoint[];
  title?: string;
  color?: string;
  height?: number;
  width?: string;
  showGrid?: boolean;
  showTooltip?: boolean;
  enableDateFilter?: boolean;
}

export default function LineChart({
  data,
  title,
  color = '#00d9ff',
  height = 240,
  width = '100%',
  showGrid = true,
  showTooltip = true,
  enableDateFilter = false,
}: LineChartProps) {
  const gradientId = useId();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filteredData = useMemo(() => {
    if (!enableDateFilter || !startDate || !endDate) return data;

    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    return data.filter(d => {
      if (!d.timestamp) return true;
      const time = new Date(d.timestamp).getTime();
      return time >= start && time <= end;
    });
  }, [data, startDate, endDate, enableDateFilter]);

  const displayData = enableDateFilter ? filteredData : data;

  if (!displayData || displayData.length < 2) {
    return (
      <div style={{ width }}>
        {enableDateFilter && (
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>From</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{
                  padding: '0.5rem',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>To</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{
                  padding: '0.5rem',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                }}
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#334155',
                  color: '#cbd5e1',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
          {displayData.length === 0 ? 'No data in selected date range' : 'Insufficient data for chart'}
        </div>
      </div>
    );
  }

  // Calculate bounds
  const values = displayData.map(d => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const padding = 40;
  const chartWidth = typeof width === 'string' ? undefined : width;
  const viewBoxWidth = 800;
  const viewBoxHeight = height * 1.5;

  // Map data to SVG coordinates
  const points = displayData.map((d, i) => {
    const x = padding + (i / (displayData.length - 1)) * (viewBoxWidth - 2 * padding);
    const y = viewBoxHeight - padding - ((d.value - minValue) / range) * (viewBoxHeight - 2 * padding);
    return { x, y, ...d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPathD = `${pathD} L ${points[points.length - 1].x} ${viewBoxHeight - padding} L ${padding} ${viewBoxHeight - padding} Z`;

  return (
    <div style={{ width }}>
      {title && (
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', fontWeight: 600 }}>
          {title}
        </div>
      )}
      {enableDateFilter && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem', fontWeight: 500 }}>From</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{
                padding: '0.5rem',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 4,
                color: '#f8fafc',
                fontSize: '0.875rem',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem', fontWeight: 500 }}>To</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={{
                padding: '0.5rem',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 4,
                color: '#f8fafc',
                fontSize: '0.875rem',
              }}
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              style={{
                padding: '0.5rem 1rem',
                background: '#334155',
                color: '#cbd5e1',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        style={{ overflow: 'visible' }}
      >
        {/* Grid lines */}
        {showGrid && (
          <>
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
              const y = viewBoxHeight - padding - pct * (viewBoxHeight - 2 * padding);
              return (
                <line
                  key={`grid-h-${pct}`}
                  x1={padding}
                  y1={y}
                  x2={viewBoxWidth - padding}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth={1}
                  strokeDasharray="4,4"
                  opacity={0.3}
                />
              );
            })}
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((pct) => {
              const x = padding + pct * (viewBoxWidth - 2 * padding);
              return (
                <line
                  key={`grid-v-${pct}`}
                  x1={x}
                  y1={padding}
                  x2={x}
                  y2={viewBoxHeight - padding}
                  stroke="#1e293b"
                  strokeWidth={1}
                  strokeDasharray="4,4"
                  opacity={0.3}
                />
              );
            })}
          </>
        )}

        {/* Area fill under curve */}
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaPathD} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <g key={`point-${i}`}>
            <circle cx={p.x} cy={p.y} r="3" fill={color} opacity="0.7" />
            {i === 0 || i === points.length - 1 ? (
              <circle cx={p.x} cy={p.y} r="4" fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" />
            ) : null}
          </g>
        ))}

        {/* X-axis labels */}
        <g>
          {points
            .filter((_, i) => i === 0 || i === Math.floor(points.length / 2) || i === points.length - 1)
            .map((p, i) => (
              <text
                key={`label-${i}`}
                x={p.x}
                y={viewBoxHeight - 10}
                textAnchor="middle"
                fill="#64748b"
                fontSize="11"
              >
                {p.label}
              </text>
            ))}
        </g>

        {/* Y-axis labels (values) */}
        <g>
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const value = minValue + pct * range;
            const y = viewBoxHeight - padding - pct * (viewBoxHeight - 2 * padding);
            return (
              <text
                key={`y-${pct}`}
                x={padding - 8}
                y={y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
              >
                {Number.isFinite(value) ? value.toFixed(0) : '--'}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
