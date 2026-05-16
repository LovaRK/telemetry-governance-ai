'use client';

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}

export default function Sparkline({
  data,
  color = '#38bdf8',
  width = 80,
  height = 28,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pad = strokeWidth + 1;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const polyline = points.join(' ');

  // Build gradient fill path
  const firstPt = points[0].split(',');
  const lastPt = points[points.length - 1].split(',');
  const fillPath = `M ${firstPt[0]},${height} L ${polyline.split(' ').join(' L ')} L ${lastPt[0]},${height} Z`;

  const gradientId = `sg-${color.replace('#', '')}-${width}`;
  const trend = data[data.length - 1] >= data[0];

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={trend ? color : '#ef4444'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
