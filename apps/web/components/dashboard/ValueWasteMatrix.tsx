'use client';

import React from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, Cell
} from 'recharts';

import { DashboardAsset } from '../../lib/mappers';

interface Props {
  assets: DashboardAsset[];
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6',
};

export default function ValueWasteMatrix({ assets }: Props) {
  const data = assets.map((a) => ({
    x: a.utilizationPct,
    y: a.costPerYear,
    z: a.riskScore,
    name: a.indexName,
    classification: a.classification,
    confidence: a.confidence,
  }));

  return (
    <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b' }}>
      <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>
        Value / Waste Matrix
      </h3>
      <div style={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              type="number"
              dataKey="x"
              name="Utilization %"
              unit="%"
              stroke="#94a3b8"
              label={{ value: 'Utilization %', position: 'bottom', fill: '#94a3b8' }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Cost/Year"
              unit="$"
              stroke="#94a3b8"
              label={{ value: 'Cost / Year', angle: -90, position: 'left', fill: '#94a3b8' }}
            />
            <ZAxis type="number" dataKey="z" range={[50, 400]} name="Risk Score" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const p = payload[0].payload;
                  return (
                    <div style={{ background: '#1e293b', padding: '0.75rem', borderRadius: '8px', border: '1px solid #334155' }}>
                      <div style={{ fontWeight: 600, color: '#f8fafc' }}>{p.name}</div>
                      <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Utilization: {p.x}%</div>
                      <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Cost: ${p.y.toLocaleString()}</div>
                      <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Risk: {p.z}</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: CLASSIFICATION_COLORS[p.classification] || '#fff' }}>
                        ● {p.classification}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Scatter name="Telemetry Assets" data={data}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={CLASSIFICATION_COLORS[entry.classification] || '#8884d8'} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
