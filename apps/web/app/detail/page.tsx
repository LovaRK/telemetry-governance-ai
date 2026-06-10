'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../../components/layout/TopAppBar';
import DecisionTimeline from '../../components/DecisionTimeline';
import ReasoningDrawer, { ReasoningDrawerProps } from '../../components/shared/ReasoningDrawer';
import BulkActionsPanel from '../../components/BulkActionsPanel';
import { ExecutiveKPIs, SnapshotRow } from '../../lib/types';
import { apiFetch } from '../../lib/api-client';
import { useAuthGuard } from '../../lib/use-auth-guard';

type DrawerData = Omit<ReasoningDrawerProps, 'isOpen' | 'onClose'>;

export default function DetailPage() {
  useAuthGuard();
  const [data, setData] = useState<any>(null);
  const [kpis, setKpis] = useState<ExecutiveKPIs | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasEverRefreshed, setHasEverRefreshed] = useState(false);
  const [hasAgentDecisions, setHasAgentDecisions] = useState(false);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const statusRes = await apiFetch('/api/cache-status');
      const statusResponse = await statusRes.json();
      const statusData = statusResponse?.data || statusResponse || {};
      const everRefreshed =
        (statusData.hasEverRefreshed ?? false) ||
        (statusData.hasData ?? false) ||
        (statusData.hasAgentDecisions ?? false) ||
        (statusData.hasKpis ?? false);
      setHasEverRefreshed(everRefreshed);
      setHasAgentDecisions(statusData.hasAgentDecisions ?? false);

      if (!everRefreshed) {
        setError('No Splunk refresh has run yet. Connect to Splunk from the main dashboard and run a refresh.');
        setLoading(false);
        return;
      }

      const safeJson = (r: Response) => r.ok ? r.json() : Promise.resolve({ data: [] });
      const [summaryRes, decisions, fields, security, quality, audit] = await Promise.all([
        apiFetch('/api/executive-summary'),
        apiFetch('/api/agent-decisions').then(safeJson),
        apiFetch('/api/field-usage').then(safeJson),
        apiFetch('/api/security-coverage').then(safeJson),
        apiFetch('/api/quality-hotspots').then(safeJson),
        apiFetch('/api/search-audit').then(safeJson),
      ]);

      if (summaryRes.ok) {
        const summaryResponse = await summaryRes.json();
        const summary = summaryResponse?.data || summaryResponse || {};
        setKpis(summary.kpis || null);
        setSnapshots(summary.snapshots || []);
      }

      setData({
        decisions: decisions?.data || [],
        fields: fields?.data || [],
        security: security?.data || [],
        quality: quality?.data || [],
        audit: audit?.data || [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar cacheStatus={null} />

      <div style={{ padding: '1.25rem', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h1 style={{ color: '#f8fafc', margin: 0, fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Telemetry Detail Dashboard
          </h1>
          <a href="/" style={{ fontSize: '0.75rem', color: '#64748b', textDecoration: 'none' }}>← Back to Executive Overview</a>
        </div>

        {error && (
          <div style={{ padding: '1rem', background: '#7f1d1d', color: '#fca5a5', borderRadius: 8, marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#64748b', padding: '4rem', textAlign: 'center' }}>Loading detail data…</div>
        ) : (
          <>
            {/* E1: KPI Row */}
            {kpis && <KpiRow kpis={kpis} />}

            {/* Decision Pipeline Timeline */}
            {hasAgentDecisions && <DecisionTimeline />}

            {/* E2: Sourcetype Health Board */}
            {snapshots.length > 0 && <HealthBoard snapshots={snapshots} />}

            {/* E14: Duplicate Collection Detection */}
            {snapshots.length > 0 && <DuplicateCollection snapshots={snapshots} />}

            {/* E7/E8: Security Detection Gaps */}
            {snapshots.length > 0 && <SecurityGaps snapshots={snapshots} onOpenDrawer={(data) => setDrawer(data)} />}

            {/* E4/E5: Data Quality Hotspots */}
            {snapshots.length > 0 && <QualityHotspots snapshots={snapshots} onOpenDrawer={(data) => setDrawer(data)} />}

            {/* E9: Operational Coverage */}
            {snapshots.length > 0 && <OperationalCoverage snapshots={snapshots} onOpenDrawer={(data) => setDrawer(data)} />}

            {/* E16: Under-Utilized Sourcetypes */}
            {snapshots.length > 0 && <UnderUtilized snapshots={snapshots} onOpenDrawer={(data) => setDrawer(data)} />}

            {/* E12/E13: Retention Overview */}
            {snapshots.length > 0 && <RetentionOverview snapshots={snapshots} />}

            {data && (
              <>
                {/* E3: LLM Sourcing Scoring Table — gated on agent_decisions */}
                <Section title="Sourcing Scoring Detail">
                  {!hasAgentDecisions
                    ? <PipelineGate label="LLM decisions not yet generated — run a Splunk refresh to populate this table." />
                    : data.decisions.length === 0
                      ? <EmptyTable label="No decisions found" />
                      : <>
                          {selectedIndexes.size > 0 && (
                            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                              <button
                                onClick={() => setShowBulkActions(true)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: '#ef4444',
                                  color: '#f8fafc',
                                  border: 'none',
                                  borderRadius: 6,
                                  fontSize: '0.85rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Apply Action to {selectedIndexes.size} Selected
                              </button>
                              <button
                                onClick={() => setSelectedIndexes(new Set())}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'transparent',
                                  color: '#64748b',
                                  border: '1px solid #334155',
                                  borderRadius: 6,
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Clear Selection
                              </button>
                            </div>
                          )}
                          <SelectableTable
                            columns={['Index', 'Sourcetype', 'Tier', 'Score', 'Utilization', 'Detection', 'Quality', 'Cost/Year', 'Action']}
                            rows={data.decisions.slice(0, 20)}
                            rowKeys={['index', 'sourcetype', 'tier', 'compositeScore', 'utilizationScore', 'detectionScore', 'qualityScore', 'annualLicenseCost', 'action']}
                            selectedIndexes={selectedIndexes}
                            onSelectChange={setSelectedIndexes}
                            indexKeyField="index"
                          />
                        </>
                  }
                </Section>

                {/* E6: Field Usage — requires Splunk tstats field query — hidden until implemented */}
                {data.fields.length > 0 && (
                  <Section title="Field Usage Analysis">
                    <Table
                      columns={['Sourcetype', 'Fields Indexed', 'Fields Used', 'Optimization %']}
                      rows={data.fields.slice(0, 20)}
                      rowKeys={['sourcetype', 'fields_indexed', 'fields_used', 'optimization_pct']}
                    />
                  </Section>
                )}

                {/* E7: MITRE Security Coverage — requires Splunk mapping — hidden until implemented */}
                {data.security.length > 0 && (
                  <Section title="Security Coverage (MITRE)">
                    <Table
                      columns={['Sourcetype', 'Coverage %', 'Active Alerts', 'Detection Gaps']}
                      rows={data.security.slice(0, 20)}
                      rowKeys={['sourcetype', 'coverage_pct', 'active_alerts', 'detection_gaps']}
                    />
                  </Section>
                )}

                {/* E4: Data Quality — requires Splunk parse-error query — hidden until implemented */}
                {data.quality.length > 0 && (
                  <Section title="Data Quality Analysis">
                    <Table
                      columns={['Sourcetype', 'Issue Count', 'Quality Score', 'Impact']}
                      rows={data.quality.slice(0, 20)}
                      rowKeys={['sourcetype', 'issue_count', 'quality_score', 'estimated_impact']}
                    />
                  </Section>
                )}

                {/* E10/E11: Search Audit */}
                <SearchAudit rows={data.audit} hasEverRefreshed={hasEverRefreshed} />
              </>
            )}
          </>
        )}
      </div>
      <ReasoningDrawer
        isOpen={!!drawer}
        onClose={() => setDrawer(null)}
        {...(drawer || { title: '' })}
      />
      {showBulkActions && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#0f172a',
            borderRadius: 12,
            border: '1px solid #1e293b',
            maxWidth: 500,
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}>
            <BulkActionsPanel
              selectedIndexes={Array.from(selectedIndexes)}
              onClose={() => setShowBulkActions(false)}
              onComplete={() => {
                setShowBulkActions(false);
                setSelectedIndexes(new Set());
                loadData();
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}

// E1: KPI summary row with gauges
function KpiRow({ kpis }: { kpis: ExecutiveKPIs }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
      <GaugeCard label="ROI Score" value={kpis.roiScore} max={100} color="#22c55e" unit="/100" />
      <GaugeCard label="Avg Confidence" value={Math.round(kpis.avgConfidence ?? 0)} max={100} color="#3b82f6" unit="%" />
      <StatCard
        label="Security Gaps"
        value={kpis.securityGaps}
        color={kpis.securityGaps > 0 ? '#ef4444' : '#22c55e'}
        subtitle={kpis.avgDetection === 0
          ? '⚠ no MITRE mapping data'
          : kpis.securityGaps === 0 ? 'no detection gaps found' : 'detection gaps identified'
        }
      />
      <StatCard
        label="Operational Gaps"
        value={kpis.operationalGaps}
        color={kpis.operationalGaps > 0 ? '#f59e0b' : '#22c55e'}
        subtitle={kpis.avgDetection === 0
          ? '⚠ no Lantern mapping data'
          : kpis.operationalGaps === 0 ? 'no operational gaps found' : 'coverage gaps identified'
        }
      />
    </div>
  );
}

function GaugeCard({ label, value, max, color, unit }: { label: string; value: number; max: number; color: string; unit: string }) {
  const pct = Math.min(value / max, 1);
  const r = 36, cx = 50, cy = 46;
  const circ = Math.PI * r;
  const dash = pct * circ;
  return (
    <div style={{ padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', textAlign: 'center' }}>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>{label}</div>
      <svg width={100} height={56} viewBox="0 0 100 56">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e293b" strokeWidth={8} />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#f8fafc" fontSize={14} fontWeight={700}>{value}{unit}</text>
      </svg>
    </div>
  );
}

function StatCard({ label, value, color, subtitle }: { label: string; value: number; color: string; subtitle: string }) {
  return (
    <div style={{ padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: `1px solid ${color}40` }}>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>{label}</div>
      <div style={{ fontSize: '2.5rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.4rem' }}>{subtitle}</div>
    </div>
  );
}

// E2: Sourcetype Health Board
function HealthBoard({ snapshots }: { snapshots: SnapshotRow[] }) {
  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Sourcetype Health Board — {snapshots.length} indexes
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {snapshots.map((s) => {
          const score = s.compositeScore;
          const healthy = score >= 70;
          const warning = score >= 40 && score < 70;
          const icon = healthy ? '✓' : warning ? '!' : '✕';
          const iconColor = healthy ? '#22c55e' : warning ? '#f59e0b' : '#ef4444';
          const borderColor = healthy ? '#22c55e30' : warning ? '#f59e0b30' : '#ef444430';
          const tierColor = TIER_COLORS[s.tier] || '#64748b';
          return (
            <div key={s.indexName + (s.sourcetype || '')} style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: `1px solid ${borderColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc', wordBreak: 'break-word', flex: 1, marginRight: '0.5rem' }}>{s.indexName}</div>
                <span style={{ fontSize: '1rem', color: iconColor, fontWeight: 800, flexShrink: 0 }}>{icon}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>
                  {s.tier}
                </span>
                <span style={{ fontSize: '0.75rem', color: iconColor, fontWeight: 700 }}>{score}</span>
              </div>
              <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.2rem', fontSize: '0.62rem', color: '#475569' }}>
                <span>U:{s.utilizationScore}</span>
                <span>D:{s.detectionScore}</span>
                <span>Q:{s.qualityScore}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// E14: Duplicate Collection Detection
function DuplicateCollection({ snapshots }: { snapshots: SnapshotRow[] }) {
  // Find sourcetypes that appear in more than one index
  const sourcetypeMap = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    if (!s.sourcetype) continue;
    const key = s.sourcetype.toLowerCase();
    if (!sourcetypeMap.has(key)) sourcetypeMap.set(key, []);
    sourcetypeMap.get(key)!.push(s);
  }

  const duplicates = Array.from(sourcetypeMap.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([sourcetype, rows]) => ({ sourcetype, indexes: rows.map(r => r.indexName), count: rows.length }));

  if (duplicates.length === 0) return null;

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #f59e0b30' }}>
      <div style={{ fontSize: '0.7rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Duplicate Collection Detected — {duplicates.length} sourcetypes in multiple indexes
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {duplicates.map((d) => (
          <div key={d.sourcetype} style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: '1px solid #f59e0b20' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.4rem' }}>{d.sourcetype}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.4rem' }}>Found in {d.count} indexes:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {d.indexes.map(idx => (
                <span key={idx} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 3, background: '#1e293b', color: '#94a3b8' }}>{idx}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// E7/E8: Security Detection Gaps
function SecurityGaps({ snapshots, onOpenDrawer }: { snapshots: SnapshotRow[]; onOpenDrawer?: (data: DrawerData) => void }) {
  const gaps = snapshots.filter((s) => s.detectionGap || s.detectionScore < 50);
  const avgDetection = snapshots.length > 0
    ? snapshots.reduce((sum, s) => sum + (s.detectionScore || 0), 0) / snapshots.length
    : 0;
  const hasLowDetection = avgDetection < 40;
  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  if (gaps.length === 0) {
    // Distinguish "genuinely great coverage" (avg detection ≥ 60) from
    // "no MITRE/Lantern mapping for these sourcetypes" (avg detection < 40)
    const emptyMsg = hasLowDetection
      ? { icon: '⚠', color: '#f59e0b', text: `No unfired MITRE detections found — avg detection score is ${Math.round(avgDetection)}%. This may indicate no MITRE/Lantern mappings exist for these sourcetypes rather than full coverage.` }
      : { icon: '✓', color: '#22c55e', text: 'No security detection gaps identified — all mapped detections are active.' };
    return (
      <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: `1px solid ${emptyMsg.color}30` }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>Security Detection Gaps</div>
        <div style={{ color: emptyMsg.color, fontSize: '0.875rem' }}>{emptyMsg.icon} {emptyMsg.text}</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #ef444430' }}>
      <div style={{ fontSize: '0.7rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Security Detection Gaps — {gaps.length} indexes at risk
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b' }}>
              {['Index', 'Tier', 'Detection Score', 'Detection Gap', 'Action', 'Recommendation', ''].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: '0.72rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gaps.map((s) => {
              const tierColor = TIER_COLORS[s.tier] || '#64748b';
              return (
                <tr key={`${s.indexName}-${s.sourcetype || ""}`} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{s.tier}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ color: s.detectionScore < 30 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>{s.detectionScore}%</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    {s.detectionGap
                      ? <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.7rem', background: '#ef444420', color: '#ef4444', fontWeight: 600 }}>Gap Detected</span>
                      : <span style={{ color: '#f59e0b', fontSize: '0.7rem' }}>Low Coverage</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                      color: s.classification === 'KEEP' ? '#22c55e' : s.classification === 'ARCHIVE' ? '#3b82f6' : '#f59e0b',
                      background: s.classification === 'KEEP' ? '#22c55e20' : s.classification === 'ARCHIVE' ? '#3b82f620' : '#f59e0b20',
                    }}>{s.classification}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.72rem' }}>
                    {s.recommendation ? s.recommendation.slice(0, 80) + (s.recommendation.length > 80 ? '…' : '') : '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                    <button
                      onClick={() => onOpenDrawer?.({
                        title: `${s.indexName} — Detection Gap`,
                        value: `Detection Score: ${s.detectionScore}%`,
                        tier: s.tier,
                        action: s.classification,
                        confidence: s.confidence * 100,
                        howCalculated: 'Detection Score measures the coverage of security detection use cases based on sourcetype configuration and recent query activity.',
                        llmReasoning: s.reasoning || 'LLM analysis indicates a potential detection gap in this index.',
                        evidence: s.detectionGap ? ['Detection gap flagged'] : ['Score below 50%'],
                        rawData: { detectionScore: s.detectionScore, detectionGap: s.detectionGap, tier: s.tier },
                      })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem' }}
                    >
                      ℹ️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// E4/E5: Data Quality Hotspots
function QualityHotspots({ snapshots, onOpenDrawer }: { snapshots: SnapshotRow[]; onOpenDrawer?: (data: DrawerData) => void }) {
  const hotspots = snapshots
    .filter((s) => s.qualityScore < 60)
    .sort((a, b) => a.qualityScore - b.qualityScore);

  if (hotspots.length === 0) {
    return (
      <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>Data Quality Hotspots</div>
        <div style={{ color: '#22c55e', fontSize: '0.875rem' }}>✓ No quality issues detected</div>
      </div>
    );
  }

  // E5: Quality issue distribution (derive issue type from score bands)
  const issueTypes = [
    { label: 'Low Confidence', count: hotspots.filter(s => s.confidence < 0.6).length, color: '#f59e0b' },
    { label: 'Low Quality Score', count: hotspots.filter(s => s.qualityScore < 40).length, color: '#ef4444' },
    { label: 'Moderate Issues', count: hotspots.filter(s => s.qualityScore >= 40 && s.qualityScore < 60).length, color: '#f97316' },
  ].filter(t => t.count > 0);

  const total = issueTypes.reduce((s, t) => s + t.count, 0);
  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #f59e0b30' }}>
      <div style={{ fontSize: '0.7rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Data Quality Hotspots — {hotspots.length} indexes below 60% quality
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
        {/* E5: Issue type distribution */}
        <div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>Issue Distribution</div>
          {issueTypes.map((t) => (
            <div key={t.label} style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <span style={{ color: '#94a3b8' }}>{t.label}</span>
                <span style={{ color: t.color, fontWeight: 700 }}>{t.count}</span>
              </div>
              <div style={{ height: 6, background: '#1e293b', borderRadius: 3 }}>
                <div style={{ height: 6, background: t.color, borderRadius: 3, width: `${(t.count / total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        {/* E4: Hotspot table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                {['Index', 'Tier', 'Quality', 'Confidence', 'Impact', ''].map((h) => (
                  <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hotspots.slice(0, 8).map((s) => {
                const tierColor = TIER_COLORS[s.tier] || '#64748b';
                const impact = (s.tier === 'Critical' || s.tier === 'Important') ? 'High' : s.qualityScore < 30 ? 'High' : 'Medium';
                return (
                  <tr key={`${s.indexName}-${s.sourcetype || ""}`} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <span style={{ padding: '0.1rem 0.3rem', borderRadius: 3, fontSize: '0.65rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{s.tier}</span>
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <span style={{ color: s.qualityScore < 30 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>{s.qualityScore}</span>
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#94a3b8' }}>{(s.confidence * 100).toFixed(0)}%</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <span style={{ color: impact === 'High' ? '#ef4444' : '#f59e0b', fontWeight: 600, fontSize: '0.7rem' }}>{impact}</span>
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                      <button
                        onClick={() => onOpenDrawer?.({
                          title: `${s.indexName} — Quality Score`,
                          value: `Quality: ${s.qualityScore}/100`,
                          tier: s.tier,
                          action: s.classification,
                          confidence: s.confidence * 100,
                          howCalculated: 'Quality Score measures data consistency, parse error rates, and field completeness based on Splunk logs.',
                          llmReasoning: s.reasoning || 'LLM identified quality issues in this index.',
                          evidence: s.qualityScore < 30 ? ['High error rate detected'] : ['Moderate issues found'],
                          rawData: { qualityScore: s.qualityScore, confidence: s.confidence, tier: s.tier },
                        })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem' }}
                      >
                        ℹ️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// E9: Operational Coverage Gaps
function OperationalCoverage({ snapshots, onOpenDrawer }: { snapshots: SnapshotRow[]; onOpenDrawer?: (data: DrawerData) => void }) {
  // Operational gaps: important/critical indexes with low utilization or flagged for elimination
  const gaps = snapshots.filter((s) => {
    if (s.tier === 'Critical' || s.tier === 'Important') {
      return s.utilizationScore < 50 || s.classification === 'ARCHIVE' || s.classification === 'ELIMINATE';
    }
    return false;
  });

  if (gaps.length === 0) return null;

  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #f59e0b30' }}>
      <div style={{ fontSize: '0.7rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Operational Coverage Gaps — {gaps.length} critical/important indexes under-utilized
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b' }}>
              {['Index', 'Tier', 'Utilization', 'Action', 'Risk', 'Gap Reason', ''].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: '0.72rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gaps.map((s) => {
              const tierColor = TIER_COLORS[s.tier] || '#64748b';
              const gapReason = s.classification === 'ELIMINATE' ? 'Marked for elimination — verify still required'
                : s.classification === 'ARCHIVE' ? 'Being archived — confirm operational needs'
                : `Low utilization (${s.utilizationScore}%) for ${s.tier} asset`;
              return (
                <tr key={`${s.indexName}-${s.sourcetype || ""}`} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{s.tier}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>{s.utilizationScore}%</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                      color: s.classification === 'ELIMINATE' ? '#ef4444' : '#3b82f6',
                      background: s.classification === 'ELIMINATE' ? '#ef444420' : '#3b82f620',
                    }}>{s.classification}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ color: s.riskScore > 50 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>{s.riskScore.toFixed(0)}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.72rem' }}>{gapReason}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                    <button
                      onClick={() => onOpenDrawer?.({
                        title: `${s.indexName} — Operational Gap`,
                        value: `Utilization: ${s.utilizationScore}%`,
                        tier: s.tier,
                        action: s.classification,
                        confidence: s.confidence * 100,
                        howCalculated: 'Operational gaps identify critical/important indexes with low utilization or scheduled elimination, suggesting potential operational coverage issues.',
                        llmReasoning: s.reasoning || 'LLM flagged an operational coverage gap.',
                        evidence: s.classification === 'ELIMINATE' ? ['Marked for elimination'] : ['Low utilization for tier'],
                        rawData: { utilizationScore: s.utilizationScore, tier: s.tier, riskScore: s.riskScore },
                      })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem' }}
                    >
                      ℹ️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// E16: Under-Utilized Sourcetypes
function UnderUtilized({ snapshots, onOpenDrawer }: { snapshots: SnapshotRow[]; onOpenDrawer?: (data: DrawerData) => void }) {
  const underUtil = snapshots
    .filter((s) => s.utilizationScore < 40)
    .sort((a, b) => a.utilizationScore - b.utilizationScore);

  if (underUtil.length === 0) return null;

  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Under-Utilized Sourcetypes — {underUtil.length} indexes below 40% utilization
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b' }}>
              {['Index', 'Tier', 'Utilization', 'GB/Day', 'Cost/Yr', 'Action', 'Suggested Use Case', ''].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: '0.72rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {underUtil.map((s) => {
              const tierColor = TIER_COLORS[s.tier] || '#64748b';
              const useCase = s.utilizationScore < 10
                ? 'Consider eliminating — near-zero query activity'
                : s.utilizationScore < 25
                ? 'Review retention policy — archive or reduce retention'
                : 'Investigate query patterns — possible optimization';
              return (
                <tr key={`${s.indexName}-${s.sourcetype || ""}`} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{s.tier}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>{s.utilizationScore}%</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.dailyAvgGb < 0.001 ? '< 0.001' : s.dailyAvgGb.toFixed(3)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{s.costPerYear > 0 ? `$${s.costPerYear.toFixed(2)}` : '$0'}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                      color: s.classification === 'ELIMINATE' ? '#ef4444' : s.classification === 'ARCHIVE' ? '#3b82f6' : '#f59e0b',
                      background: s.classification === 'ELIMINATE' ? '#ef444420' : s.classification === 'ARCHIVE' ? '#3b82f620' : '#f59e0b20',
                    }}>{s.classification}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.72rem' }}>{useCase}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                    <button
                      onClick={() => onOpenDrawer?.({
                        title: `${s.indexName} — Utilization`,
                        value: `Utilization: ${s.utilizationScore}%`,
                        tier: s.tier,
                        action: s.classification,
                        confidence: s.confidence * 100,
                        howCalculated: 'Utilization Score measures query frequency, data freshness, and active use based on Splunk query logs.',
                        llmReasoning: s.reasoning || 'LLM assessed utilization as low, suggesting optimization opportunity.',
                        evidence: [`${s.utilizationScore}% utilization rate`, `Cost/year: $${s.costPerYear.toFixed(2)}`],
                        rawData: { utilizationScore: s.utilizationScore, dailyAvgGb: s.dailyAvgGb, costPerYear: s.costPerYear },
                      })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem' }}
                    >
                      ℹ️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// E12/E13: Retention Overview
function RetentionOverview({ snapshots }: { snapshots: SnapshotRow[] }) {
  const fmt$ = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}k` : v >= 1 ? `$${v.toFixed(0)}` : v > 0 ? `$${v.toFixed(2)}` : '$0';

  type RetItem = { indexName: string; sourcetype: string; tier: string; retentionDays: number; utilizationScore: number; costPerYear: number; recommendation: string };
  const items: RetItem[] = snapshots
    .map((s) => {
      let rec = '';
      if (s.retentionDays > 365 && s.utilizationScore < 30) {
        rec = `Reduce from ${s.retentionDays}d → 90d — high retention, low utilization`;
      } else if (s.retentionDays > 180 && s.utilizationScore < 50) {
        rec = `Consider reducing from ${s.retentionDays}d → 90d`;
      } else if (s.retentionDays <= 30 && s.utilizationScore > 70) {
        rec = `Increase from ${s.retentionDays}d — high utilization, short retention`;
      } else {
        rec = 'Retention looks appropriate';
      }
      return { indexName: s.indexName, sourcetype: s.sourcetype || '', tier: s.tier, retentionDays: s.retentionDays, utilizationScore: s.utilizationScore, costPerYear: s.costPerYear, recommendation: rec };
    })
    .sort((a, b) => b.retentionDays - a.retentionDays);

  const TIER_COLORS: Record<string, string> = {
    Critical: '#ef4444', Important: '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
  };

  return (
    <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Retention Optimization — {items.length} indexes
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b' }}>
              {['Index', 'Tier', 'Retention (days)', 'Utilization', 'Cost/Yr', 'Recommendation'].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: '0.72rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const tierColor = TIER_COLORS[s.tier] || '#64748b';
              const isActionable = !s.recommendation.startsWith('Retention looks');
              return (
                <tr key={`${s.indexName}-${s.sourcetype || ""}`} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#f8fafc', fontWeight: 600 }}>{s.indexName}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.7rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600 }}>{s.tier}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontWeight: 600 }}>{s.retentionDays}d</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: s.utilizationScore < 30 ? '#ef4444' : s.utilizationScore < 60 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>
                    {s.utilizationScore}%
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{fmt$(s.costPerYear)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: isActionable ? '#f59e0b' : '#475569', fontSize: '0.75rem' }}>{s.recommendation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// E10/E11: Search Audit
function SearchAudit({ rows, hasEverRefreshed }: { rows: any[]; hasEverRefreshed?: boolean }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ marginBottom: '2rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>
          Saved Search &amp; Alert Audit
        </div>
        <div style={{ color: '#475569', fontSize: '0.875rem' }}>
          {hasEverRefreshed
            ? 'No saved searches found in last Splunk refresh.'
            : 'Connect to Splunk and run a refresh to populate saved search audit data.'}
        </div>
      </div>
    );
  }

  const orphans = rows.filter(r => r.status === 'orphan');
  const unused = rows.filter(r => r.status === 'unused' || r.is_unused);
  const lowConf = rows.filter(r => Number(r.confidence_score) < 50 && r.status !== 'orphan' && r.status !== 'unused');
  const active = rows.filter(r => r.status === 'active' && Number(r.confidence_score) >= 50);

  return (
    <div style={{ marginBottom: '2rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600 }}>
        Saved Search &amp; Alert Audit — {rows.length} total
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: '1px solid #ef444430' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ef4444' }}>{orphans.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>Orphan Searches</div>
        </div>
        <div style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: '1px solid #ef444430' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ef4444' }}>{unused.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>Unused Searches</div>
        </div>
        <div style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: '1px solid #f59e0b30' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>{lowConf.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>Low-Confidence</div>
        </div>
        <div style={{ padding: '0.875rem', background: '#0a1628', borderRadius: 8, border: '1px solid #22c55e30' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#22c55e' }}>{active.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>Active Alerts</div>
        </div>
      </div>
      {(orphans.length > 0 || unused.length > 0) && (
        <>
          <div style={{ fontSize: '0.65rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>High-Risk Searches (Orphan / Unused)</div>
          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Name', 'App', 'Type', 'Status', 'Risk', 'Reason'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...orphans, ...unused].slice(0, 15).map((r, i) => {
                  const rl = (r.risk_level || 'MEDIUM').toUpperCase();
                  const rlColor = rl === 'HIGH' ? '#ef4444' : rl === 'LOW' ? '#22c55e' : '#f59e0b';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#f8fafc', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.search_name}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#94a3b8' }}>{r.app}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#94a3b8' }}>{r.search_type || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#64748b', textTransform: 'capitalize' }}>{r.status}</td>
                      <td style={{ padding: '0.4rem 0.5rem', fontWeight: 700, color: rlColor }}>{rl}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#64748b', fontSize: '0.72rem' }}>{r.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {lowConf.length > 0 && (
        <>
          <div style={{ fontSize: '0.65rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>Low-Confidence / Unresolved Searches</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Name', 'App', 'Confidence', 'Reason'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lowConf.slice(0, 10).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#f8fafc', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.search_name}</td>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#94a3b8' }}>{r.app}</td>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#f59e0b', fontWeight: 700 }}>{Number(r.confidence_score).toFixed(0)}%</td>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#64748b', fontSize: '0.72rem' }}>{r.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PipelineGate({ label }: { label: string }) {
  return (
    <div style={{ padding: '0.75rem 1rem', background: '#0c1a0c', border: '1px solid #166534', borderRadius: 8, color: '#4ade80', fontSize: '0.8rem' }}>
      ⏳ {label}
    </div>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div style={{ color: '#475569', fontSize: '0.875rem' }}>{label}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem', padding: '1.25rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: '1rem', marginTop: 0, marginBottom: '1rem' }}>{title}</h2>
      {children}
    </div>
  );
}

function Table({ columns, rows, rowKeys }: { columns: string[]; rows: any[]; rowKeys: string[] }) {
  if (!rows || rows.length === 0) {
    return <div style={{ color: '#64748b', fontSize: '0.875rem' }}>No data</div>;
  }

  return (
    <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', color: '#cbd5e1' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1e293b' }}>
            {columns.map((col) => (
              <th key={col} style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#94a3b8' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid #1e293b' }}>
              {rowKeys.map((key) => (
                <td key={key} style={{ padding: '0.75rem' }}>
                  {row[key] !== null && row[key] !== undefined
                    ? String(row[key]).slice(0, 50)
                    : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectableTable({
  columns,
  rows,
  rowKeys,
  selectedIndexes,
  onSelectChange,
  indexKeyField,
}: {
  columns: string[];
  rows: any[];
  rowKeys: string[];
  selectedIndexes: Set<string>;
  onSelectChange: (selected: Set<string>) => void;
  indexKeyField: string;
}) {
  if (!rows || rows.length === 0) {
    return <div style={{ color: '#64748b', fontSize: '0.875rem' }}>No data</div>;
  }

  const toggleRow = (indexName: string) => {
    const newSelected = new Set(selectedIndexes);
    if (newSelected.has(indexName)) {
      newSelected.delete(indexName);
    } else {
      newSelected.add(indexName);
    }
    onSelectChange(newSelected);
  };

  const toggleAll = () => {
    if (selectedIndexes.size === rows.length) {
      onSelectChange(new Set());
    } else {
      const allSelected = new Set(rows.map(r => r[indexKeyField]));
      onSelectChange(allSelected);
    }
  };

  return (
    <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', color: '#cbd5e1' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1e293b' }}>
            <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', width: 40 }}>
              <input
                type="checkbox"
                checked={selectedIndexes.size === rows.length && rows.length > 0}
                onChange={toggleAll}
                style={{ cursor: 'pointer' }}
              />
            </th>
            {columns.map((col) => (
              <th key={col} style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#94a3b8' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const indexName = row[indexKeyField];
            const isSelected = selectedIndexes.has(indexName);
            return (
              <tr
                key={idx}
                style={{
                  borderBottom: '1px solid #1e293b',
                  background: isSelected ? '#1e293b30' : undefined,
                }}
              >
                <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRow(indexName)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                {rowKeys.map((key) => (
                  <td key={key} style={{ padding: '0.75rem' }}>
                    {row[key] !== null && row[key] !== undefined
                      ? String(row[key]).slice(0, 50)
                      : '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
