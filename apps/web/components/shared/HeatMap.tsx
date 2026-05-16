'use client';

import React, { useMemo } from 'react';

interface HeatMapCell {
  xBin: string;
  yBin: string;
  count: number;
  cost: number;
  indexes: string[];
}

interface Props {
  data: HeatMapCell[];
  title?: string;
  width?: string;
  height?: number;
  colorScheme?: 'default' | 'diverging';
}

const BIN_LABELS_X = ['0-10GB', '10-50GB', '50-100GB', '100GB+'];
const BIN_LABELS_Y = ['0-30d', '30-90d', '90-180d', '180-365d', '365+d'];

export default function HeatMap({ data, title = 'Retention vs Daily Ingest', width = '100%', height = 400, colorScheme = 'default' }: Props) {
  const cellSize = 60;
  const margin = { left: 120, right: 20, top: 30, bottom: 100 };
  const svgWidth = BIN_LABELS_X.length * cellSize + margin.left + margin.right;
  const svgHeight = Math.max(BIN_LABELS_Y.length * cellSize + margin.top + margin.bottom, height || 400);

  const maxCount = useMemo(() => {
    return Math.max(...data.map(d => d.count), 1);
  }, [data]);

  const getColor = (count: number) => {
    if (count === 0) return '#0f172a';
    const ratio = count / maxCount;
    if (colorScheme === 'diverging') {
      if (ratio < 0.33) return '#10b981';
      if (ratio < 0.66) return '#f59e0b';
      return '#ef4444';
    }
    // Default: cool to warm gradient
    if (ratio < 0.25) return '#1e40af';
    if (ratio < 0.5) return '#3b82f6';
    if (ratio < 0.75) return '#f59e0b';
    return '#ef4444';
  };

  const getCellData = (xBin: string, yBin: string): HeatMapCell | undefined => {
    return data.find(d => d.xBin === xBin && d.yBin === yBin);
  };

  return (
    <div style={{ width, padding: '1.5rem', background: '#1e293b', borderRadius: 12 }}>
      {title && <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 600 }}>{title}</h3>}

      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minWidth: svgWidth, height: 'auto', background: '#0f172a', borderRadius: 8 }}>
          {/* Y axis labels */}
          {BIN_LABELS_Y.map((label, i) => (
            <text
              key={`y-label-${i}`}
              x={margin.left - 10}
              y={margin.top + i * cellSize + cellSize / 2}
              textAnchor="end"
              dominantBaseline="middle"
              style={{ fontSize: 12, fill: '#94a3b8' }}
            >
              {label}
            </text>
          ))}

          {/* X axis labels */}
          {BIN_LABELS_X.map((label, i) => (
            <text
              key={`x-label-${i}`}
              x={margin.left + i * cellSize + cellSize / 2}
              y={svgHeight - margin.bottom + 20}
              textAnchor="middle"
              dominantBaseline="start"
              style={{ fontSize: 12, fill: '#94a3b8' }}
            >
              {label}
            </text>
          ))}

          {/* Y axis title */}
          <text
            x={15}
            y={margin.top + (BIN_LABELS_Y.length * cellSize) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(-90 15 ${margin.top + (BIN_LABELS_Y.length * cellSize) / 2})`}
            style={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }}
          >
            Retention Days
          </text>

          {/* X axis title */}
          <text
            x={margin.left + (BIN_LABELS_X.length * cellSize) / 2}
            y={svgHeight - 5}
            textAnchor="middle"
            dominantBaseline="end"
            style={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }}
          >
            Daily Ingest (GB)
          </text>

          {/* Heat map cells */}
          {BIN_LABELS_Y.map((yBin, yi) => (
            BIN_LABELS_X.map((xBin, xi) => {
              const cellData = getCellData(xBin, yBin);
              const count = cellData?.count ?? 0;
              const bgColor = getColor(count);
              const x = margin.left + xi * cellSize;
              const y = margin.top + yi * cellSize;

              return (
                <g key={`cell-${xi}-${yi}`}>
                  <rect
                    x={x}
                    y={y}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    fill={bgColor}
                    stroke="#334155"
                    strokeWidth={1}
                  />
                  {count > 0 && (
                    <>
                      <text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2 - 8}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: 18, fontWeight: 700, fill: '#f8fafc' }}
                      >
                        {count}
                      </text>
                      <text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2 + 10}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: 10, fill: '#cbd5e1' }}
                      >
                        ${cellData?.cost ? (cellData.cost / 1000).toFixed(1) : '0'}k
                      </text>
                    </>
                  )}
                </g>
              );
            })
          ))}

          {/* Legend */}
          <g transform={`translate(${svgWidth - 200} ${margin.top})`}>
            <text x={0} y={0} style={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}>Legend</text>
            <rect x={0} y={15} width={15} height={15} fill={colorScheme === 'diverging' ? '#10b981' : '#1e40af'} stroke="#334155" strokeWidth={1} />
            <text x={20} y={27} style={{ fontSize: 10, fill: '#cbd5e1' }}>Low</text>

            <rect x={0} y={40} width={15} height={15} fill={colorScheme === 'diverging' ? '#f59e0b' : '#f59e0b'} stroke="#334155" strokeWidth={1} />
            <text x={20} y={52} style={{ fontSize: 10, fill: '#cbd5e1' }}>Medium</text>

            <rect x={0} y={65} width={15} height={15} fill="#ef4444" stroke="#334155" strokeWidth={1} />
            <text x={20} y={77} style={{ fontSize: 10, fill: '#cbd5e1' }}>High</text>
          </g>
        </svg>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#64748b' }}>
        Cell color intensity represents index concentration. Brighter = higher risk (more indexes with expensive retention profiles).
      </div>
    </div>
  );
}
