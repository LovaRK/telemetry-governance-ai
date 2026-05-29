'use client';

/**
 * SpendRiskMatrix — D11 Utilization×Detection scatter + D8 Top Indexes by Volume + D12 Archive candidates.
 * Pure visualization — receives all data as props, openDrawer callback lifted to parent.
 */

import React from 'react';
import { fmt$, fmtGB, ACTION_COLORS, tierColor } from './utils';

interface Snapshot {
  indexName: string;
  tier: string;
  action: string;
  dailyAvgGb: number;
  costPerYear: number;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  compositeScore: number;
  isS3Candidate?: boolean;
  estimatedSavings?: number;
  classification?: string;
}

interface DrawerPayload {
  isOpen: boolean;
  metric: string;
  value: string | number;
  title: string;
  howCalculated: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  rawData?: Record<string, unknown>;
}

interface SpendRiskMatrixProps {
  snapshots: Snapshot[];
  avgConfidencePct: number;
  agentReasoning?: string;
  onOpenDrawer?: (payload: DrawerPayload) => void;
}

const AIBadge = (
  <div style={{
    position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
    backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
    borderRadius: '12px', fontWeight: 500,
  }}>🤖 AI</div>
);

const FactBadge = (
  <div style={{
    position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
    backgroundColor: '#27AE60', color: 'white', padding: '2px 8px',
    borderRadius: '12px', fontWeight: 500,
  }}>✓ FACT</div>
);

const card: React.CSSProperties = {
  padding: '1.5rem', background: '#0f172a', borderRadius: 12,
  border: '1px solid #1e293b', position: 'relative',
};

const cardTitle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600,
};

export function SpendRiskMatrix({
  snapshots,
  avgConfidencePct,
  agentReasoning = '',
  onOpenDrawer,
}: SpendRiskMatrixProps) {
  const open = (payload: DrawerPayload) => onOpenDrawer?.(payload);

  // D8: Top 6 by volume
  const top6ByVol = [...snapshots].sort((a, b) => b.dailyAvgGb - a.dailyAvgGb).slice(0, 6);
  const maxVol = Math.max(...top6ByVol.map(s => s.dailyAvgGb), 0.001);

  // D12: Archive / S3 candidates
  const archiveCandidates = snapshots.filter(s => s.isS3Candidate || /archive|s3/i.test(s.action ?? ''));

  // D11: Scatter dimensions
  const maxGb = Math.max(...snapshots.map(s => s.dailyAvgGb), 0.001);

  return (
    <>
      {/* Row 5 — D11 + D8 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* D11: Utilization × Detection Quadrant */}
        <div style={card}>
          {AIBadge}
          <div style={cardTitle}>Utilization × Detection</div>
          {snapshots.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.875rem' }}>No data</div>
          ) : (() => {
            const W = 360, H = 200, MX = 30, MY = 14;
            const PW = W - 2 * MX, PH = H - 2 * MY;
            const mapX = (v: number) => MX + (v / 100) * PW;
            const mapY = (v: number) => H - MY - (v / 100) * PH;
            return (
              <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
                  style={{ overflow: 'hidden', display: 'block', maxWidth: '100%' }}>
                  {/* Quadrant fills */}
                  <rect x={MX} y={MY} width={PW / 2} height={PH / 2} fill="#3b82f608" />
                  <rect x={MX + PW / 2} y={MY} width={PW / 2} height={PH / 2} fill="#22c55e08" />
                  <rect x={MX} y={MY + PH / 2} width={PW / 2} height={PH / 2} fill="#ef444408" />
                  <rect x={MX + PW / 2} y={MY + PH / 2} width={PW / 2} height={PH / 2} fill="#f59e0b08" />
                  {/* Midlines */}
                  <line x1={mapX(50)} y1={MY} x2={mapX(50)} y2={H - MY} stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3" />
                  <line x1={MX} y1={mapY(50)} x2={W - MX} y2={mapY(50)} stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3" />
                  {/* Axis labels */}
                  <text x={W / 2} y={H - 1} textAnchor="middle" fill="#334155" fontSize={9}>Utilization →</text>
                  <text x={8} y={H / 2} textAnchor="middle" fill="#334155" fontSize={9} transform={`rotate(-90,8,${H / 2})`}>Detection →</text>
                  {/* Quadrant labels */}
                  <text x={MX + 4} y={MY + 10} fill="#3b82f6" fontSize={8} opacity={0.7}>LU/HD</text>
                  <text x={W - MX - 4} y={MY + 10} textAnchor="end" fill="#22c55e" fontSize={8} opacity={0.7}>HU/HD ✓</text>
                  <text x={MX + 4} y={H - MY - 4} fill="#ef4444" fontSize={8} opacity={0.7}>LU/LD</text>
                  <text x={W - MX - 4} y={H - MY - 4} textAnchor="end" fill="#f59e0b" fontSize={8} opacity={0.7}>HU/LD</text>
                  {/* Bubbles */}
                  {snapshots.map((s, i) => {
                    const bR = Math.min(Math.max(Math.sqrt(s.dailyAvgGb / maxGb) * 16 + 3, 4), 18);
                    const col = tierColor(s.tier);
                    return (
                      <g key={i} style={{ cursor: 'pointer' }} onClick={() => open({
                        isOpen: true,
                        metric: 'scatter_bubble',
                        value: `U:${s.utilizationScore.toFixed(0)}% D:${s.detectionScore.toFixed(0)}%`,
                        title: `Index: ${s.indexName}`,
                        howCalculated: `Utilization Score: ${s.utilizationScore.toFixed(0)}%\nDetection Score: ${s.detectionScore.toFixed(0)}%\nDaily Ingest: ${fmtGB(s.dailyAvgGb)}\nTier: ${s.tier}\nAction: ${s.action}`,
                        llmReasoning: agentReasoning,
                        evidence: [
                          `Index: ${s.indexName}`,
                          `Tier: ${s.tier}`,
                          `Utilization: ${s.utilizationScore.toFixed(0)}%`,
                          `Detection: ${s.detectionScore.toFixed(0)}%`,
                          `Daily Volume: ${fmtGB(s.dailyAvgGb)}`,
                          `Quality Score: ${s.qualityScore.toFixed(0)}%`,
                          `Recommended Action: ${s.action}`,
                        ],
                        confidence: avgConfidencePct,
                        tier: s.tier,
                        action: s.action,
                        rawData: {
                          indexName: s.indexName,
                          tier: s.tier,
                          action: s.action,
                          utilizationScore: s.utilizationScore,
                          detectionScore: s.detectionScore,
                          qualityScore: s.qualityScore,
                          dailyAvgGb: s.dailyAvgGb,
                          costPerYear: s.costPerYear,
                        },
                      })}>
                        <circle
                          cx={mapX(s.utilizationScore)} cy={mapY(s.detectionScore)}
                          r={bR} fill={col} fillOpacity={0.65} stroke={col} strokeWidth={1} strokeOpacity={0.9}
                        />
                        <title>{s.indexName}: Util={s.utilizationScore.toFixed(0)}, Det={s.detectionScore.toFixed(0)}, {fmtGB(s.dailyAvgGb)}/day</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {[['Critical', '#ef4444'], ['Important', '#f59e0b'], ['Nice-to-Have', '#3b82f6'], ['Low Value', '#64748b']].map(([lbl, col]) => (
              <span key={lbl} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.65rem', color: '#94a3b8' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, display: 'inline-block' }} />{lbl}
              </span>
            ))}
          </div>
        </div>

        {/* D8: Top Indexes by Volume */}
        <div style={card}>
          {FactBadge}
          <div style={cardTitle}>Top Indexes by Volume</div>
          {top6ByVol.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.875rem' }}>No data</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {top6ByVol.map((s) => {
                const pct = (s.dailyAvgGb / maxVol) * 100;
                const col = tierColor(s.tier);
                return (
                  <div key={s.indexName}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>
                        {s.indexName}
                      </span>
                      <span style={{ color: col, fontWeight: 600 }}>{fmtGB(s.dailyAvgGb)}/d</span>
                    </div>
                    <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 6 — D12: S3 / Archive Candidates Table */}
      {archiveCandidates.length > 0 && (
        <div style={card}>
          {AIBadge}
          <div style={cardTitle}>
            S3 / Archive Candidates — {archiveCandidates.length} indexes
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Index', 'Tier', 'Score', 'GB/Day', 'License/Yr', 'Utilization', 'Detection', 'Action'].map(h => (
                    <th key={h} style={{
                      padding: '0.5rem 0.75rem', textAlign: 'left',
                      color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {archiveCandidates.slice(0, 10).map((s, i) => {
                  const col = tierColor(s.tier);
                  const actColor = ACTION_COLORS[s.action] || '#3b82f6';
                  return (
                    <tr key={s.indexName} style={{
                      borderBottom: '1px solid #0f172a',
                      background: i % 2 ? '#ffffff05' : 'transparent',
                    }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{
                          padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem',
                          fontWeight: 600, background: col + '20', color: col,
                        }}>{s.tier}</span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.compositeScore.toFixed(0)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#cbd5e1' }}>{fmtGB(s.dailyAvgGb)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#cbd5e1' }}>{fmt$(s.costPerYear)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.utilizationScore.toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.detectionScore.toFixed(0)}%</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{
                          padding: '0.2rem 0.5rem', borderRadius: 4, fontSize: '0.7rem',
                          fontWeight: 600, background: actColor + '20', color: actColor,
                        }}>{s.action}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {archiveCandidates.length > 10 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
              Showing 10 of {archiveCandidates.length} candidates
            </div>
          )}
        </div>
      )}
    </>
  );
}
