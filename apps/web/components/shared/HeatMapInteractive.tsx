'use client';

import React, { useState } from 'react';

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
  onCellClick?: (cell: HeatMapCell) => void;
}

const BIN_LABELS_X = ['0-10GB', '10-50GB', '50-100GB', '100GB+'];
const BIN_LABELS_Y = ['0-30d', '30-90d', '90-180d', '180-365d', '365+d'];

interface DrilldownView {
  cell: HeatMapCell | null;
}

export default function HeatMapInteractive({ data, title = 'Retention vs Daily Ingest', width = '100%', height = 400, onCellClick }: Props) {
  const [drilldown, setDrilldown] = useState<DrilldownView>({ cell: null });

  const cellSize = 60;
  const margin = { left: 120, right: 20, top: 30, bottom: 100 };
  const svgWidth = BIN_LABELS_X.length * cellSize + margin.left + margin.right;
  const svgHeight = Math.max(BIN_LABELS_Y.length * cellSize + margin.top + margin.bottom, height || 400);

  const maxCount = Math.max(...data.map(d => d.count), 1);

  const getColor = (count: number) => {
    if (count === 0) return '#0f172a';
    const ratio = count / maxCount;
    if (ratio < 0.25) return '#1e40af';
    if (ratio < 0.5) return '#3b82f6';
    if (ratio < 0.75) return '#f59e0b';
    return '#ef4444';
  };

  const getCellData = (xBin: string, yBin: string): HeatMapCell | undefined => {
    return data.find(d => d.xBin === xBin && d.yBin === yBin);
  };

  if (drilldown.cell) {
    const cell = drilldown.cell;
    return (
      <div style={{ width, padding: '1.5rem', background: '#1e293b', borderRadius: 12 }}>
        <button
          onClick={() => setDrilldown({ cell: null })}
          style={{
            marginBottom: '1rem',
            padding: '0.5rem 1rem',
            background: '#1e293b',
            color: '#3b82f6',
            border: '1px solid #334155',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          ← Back to Matrix
        </button>

        <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1.125rem', fontWeight: 600 }}>
          {cell.xBin} Ingest × {cell.yBin} Retention
        </h3>

        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#0f172a', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Count</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>{cell.count}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Annual Cost</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
                ${(cell.cost / 1000).toFixed(1)}k
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
              INDEXES IN THIS ZONE ({cell.indexes.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.25rem' }}>
              {cell.indexes.slice(0, 10).map((idx, i) => (
                <div
                  key={i}
                  style={{
                    padding: '0.5rem',
                    background: '#1e293b',
                    borderRadius: 4,
                    fontSize: '0.8125rem',
                    color: '#cbd5e1',
                    fontFamily: 'monospace',
                    border: '1px solid #334155',
                  }}
                >
                  {idx}
                </div>
              ))}
              {cell.indexes.length > 10 && (
                <div style={{ color: '#94a3b8', fontSize: '0.75rem', padding: '0.5rem', textAlign: 'center' }}>
                  +{cell.indexes.length - 10} more
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>
          This zone contains {cell.count} {cell.count === 1 ? 'index' : 'indexes'} with {cell.xBin} daily ingest and {cell.yBin} retention.
          High-retention + high-ingest zones (top-right) represent the most expensive configurations and should be reviewed for optimization.
        </div>
      </div>
    );
  }

  return (
    <div style={{ width, padding: '1.5rem', background: '#1e293b', borderRadius: 12 }}>
      {title && <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 600 }}>{title}</h3>}

      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minWidth: svgWidth, height: 'auto', background: '#0f172a', borderRadius: 8 }}>
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

          <text
            x={margin.left + (BIN_LABELS_X.length * cellSize) / 2}
            y={svgHeight - 5}
            textAnchor="middle"
            dominantBaseline="end"
            style={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }}
          >
            Daily Ingest (GB)
          </text>

          {BIN_LABELS_Y.map((yBin, yi) => (
            BIN_LABELS_X.map((xBin, xi) => {
              const cellData = getCellData(xBin, yBin);
              const count = cellData?.count ?? 0;
              const bgColor = getColor(count);
              const x = margin.left + xi * cellSize;
              const y = margin.top + yi * cellSize;

              return (
                <g
                  key={`cell-${xi}-${yi}`}
                  onClick={() => {
                    if (cellData) {
                      setDrilldown({ cell: cellData });
                      onCellClick?.(cellData);
                    }
                  }}
                  style={{ cursor: cellData ? 'pointer' : 'default' }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    fill={bgColor}
                    stroke={cellData ? '#64748b' : '#334155'}
                    strokeWidth={cellData ? 2 : 1}
                    opacity={cellData ? 1 : 0.5}
                  />
                  {count > 0 && (
                    <>
                      <text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2 - 8}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: 18, fontWeight: 700, fill: '#f8fafc', pointerEvents: 'none' }}
                      >
                        {count}
                      </text>
                      <text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2 + 10}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: 10, fill: '#cbd5e1', pointerEvents: 'none' }}
                      >
                        ${cellData?.cost ? (cellData.cost / 1000).toFixed(1) : '0'}k
                      </text>
                    </>
                  )}
                </g>
              );
            })
          ))}
        </svg>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#64748b' }}>
        💡 Click any cell to see which indexes are in that zone. High-retention, high-ingest zones (top-right) are candidates for optimization.
      </div>
    </div>
  );
}
