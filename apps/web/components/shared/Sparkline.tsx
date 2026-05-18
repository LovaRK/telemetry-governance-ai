'use client';

import React from 'react';

interface SparklineProps {
  data: number[];          // Array of values (e.g., last 7 days)
  color?: string;          // Hex color (default: #3b82f6)
  width?: number;          // SVG width in pixels (default: 100)
  height?: number;         // SVG height in pixels (default: 40)
  showGradient?: boolean;  // Show gradient fill under line (default: true)
}

export default function Sparkline({
  data,
  color = '#3b82f6',
  width = 100,
  height = 40,
  showGradient = true,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return null;
  }

  // Handle single data point
  if (data.length === 1) {
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <circle cx={width / 2} cy={height / 2} r="2" fill={color} />
      </svg>
    );
  }

  // Find min and max
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Avoid division by zero

  // Map data to SVG coordinates
  const padding = 4;
  const svgWidth = width - 2 * padding;
  const svgHeight = height - 2 * padding;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * svgWidth;
    const y = padding + ((max - value) / range) * svgHeight;
    return { x, y, value };
  });

  // Create polyline path string
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Create gradient path for fill
  const fillPoints = [
    ...points.map((p) => `${p.x},${p.y}`),
    `${points[points.length - 1].x},${height}`,
    `${points[0].x},${height}`,
  ].join(' ');

  const gradientId = `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {showGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.3 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
      )}

      {/* Gradient fill */}
      {showGradient && (
        <polygon points={fillPoints} fill={`url(#${gradientId})`} />
      )}

      {/* Line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={color} />
      ))}
    </svg>
  );
}
