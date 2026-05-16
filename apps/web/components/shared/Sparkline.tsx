'use client';

import React from 'react';

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export default function Sparkline({
  data,
  color = '#00d9ff',
  width = 100,
  height = 32,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          backgroundColor: 'rgba(51, 65, 85, 0.3)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: '#64748b',
        }}
      >
        No data
      </div>
    );
  }

  // Calculate min/max for scaling
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Prevent division by zero

  // Create SVG polyline points
  const pointsArray = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const points = pointsArray.join(' ');

  // Calculate trend: up/down/flat
  const trend = data[data.length - 1] - data[0];
  const trendColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#94a3b8';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        width={width}
        height={height}
        style={{
          overflow: 'visible',
          display: 'block',
        }}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Fill area under curve */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="url(#sparklineGradient)"
        />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        {/* Start point */}
        <circle cx={0} cy={height - ((data[0] - min) / range) * (height - 4) - 2} r="1.5" fill={color} />

        {/* End point */}
        <circle
          cx={width}
          cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
          r="1.5"
          fill={trendColor}
        />
      </svg>

      {/* Trend indicator */}
      <div
        style={{
          position: 'absolute',
          right: -16,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '11px',
          fontWeight: 600,
          color: trendColor,
        }}
      >
        {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
      </div>
    </div>
  );
}
