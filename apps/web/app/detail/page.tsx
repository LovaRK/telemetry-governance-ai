'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../../components/layout/TopAppBar';
import { ExecutiveKPIs, SnapshotRow } from '../../lib/types';

export default function DetailPage() {
  const [data, setData] = useState<any>(null);
  const [kpis, setKpis] = useState<ExecutiveKPIs | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const statusRes = await fetch('/api/cache-status');
        const statusData = await statusRes.json();

        if (!statusData.has_data) {
          setError('No data available. Run a Splunk refresh first.');
          setLoading(false);
          return;
        }

        const safeJson = (r: Response) => r.ok ? r.json() : Promise.resolve({ data: [] });
        const [summaryRes, decisions, fields, security, quality, audit] = await Promise.all([
          fetch('/api/executive-summary'),
          fetch('/api/agent-decisions').then(safeJson),
          fetch('/api/field-usage').then(safeJson),
          fetch('/api/security-coverage').then(safeJson),
          fetch('/api/quality-hotspots').then(safeJson),
          fetch('/api/search-audit').then(safeJson),
        ]);

        if (summaryRes.ok) {
          const summary = await summaryRes.json();
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

            {/* E2: Sourcetype Health Board */}
            {snapshots.length > 0 && <HealthBoard snapshots={snapshots} />}

            {data && (
              <>
                {/* Sourcing Scoring Table */}
                <Section title="Sourcing Scoring Table">
                  <Table
                    columns={['Index', 'Sourcetype', 'Tier', 'Score', 'Utilization', 'Detection', 'Quality', 'Cost/Year', 'Action']}
                    rows={data.decisions.slice(0, 20)}
                    rowKeys={['index_name', 'sourcetype', 'tier', 'composite_score', 'utilization_score', 'detection_score', 'quality_score', 'annual_license_cost', 'action']}
                  />
                </Section>

                {/* Field Usage Table */}
                <Section title="Field Usage Analysis">
                  <Table
                    columns={['Sourcetype', 'Fields Indexed', 'Fields Used', 'Optimization %']}
                    rows={data.fields.slice(0, 20)}
                    rowKeys={['sourcetype', 'fields_indexed', 'fields_used', 'optimization_pct']}
                  />
                </Section>

                {/* Security Coverage */}
                <Section title="Security Coverage (MITRE)">
                  <Table
                    columns={['Sourcetype', 'Coverage %', 'Active Alerts', 'Detection Gaps']}
                    rows={data.security.slice(0, 20)}
                    rowKeys={['sourcetype', 'coverage_pct', 'active_alerts', 'detection_gaps']}
                  />
                </Section>

                {/* Quality Hotspots */}
                <Section title="Data Quality Analysis">
                  <Table
                    columns={['Sourcetype', 'Issue Count', 'Quality Score', 'Impact']}
                    rows={data.quality.slice(0, 20)}
                    rowKeys={['sourcetype', 'issue_count', 'quality_score', 'estimated_impact']}
                  />
                </Section>

                {/* Search Audit */}
                <Section title="Search Audit">
                  <Table
                    columns={['Search Name', 'Type', 'App', 'Confidence', 'Reason']}
                    rows={data.audit.slice(0, 20)}
                    rowKeys={['search_name', 'search_type', 'app', 'confidence_score', 'reason']}
                  />
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// E1: KPI summary row with gauges
function KpiRow({ kpis }: { kpis: ExecutiveKPIs }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
      <GaugeCard label="ROI Score" value={kpis.roiScore} max={100} color="#22c55e" unit="/100" />
      <GaugeCard label="Avg Confidence" value={Math.round(kpis.avgConfidence * 100)} max={100} color="#3b82f6" unit="%" />
      <StatCard label="Security Gaps" value={kpis.securityGaps} color={kpis.securityGaps > 0 ? '#ef4444' : '#22c55e'} subtitle="detection gaps identified" />
      <StatCard label="Operational Gaps" value={kpis.operationalGaps} color={kpis.operationalGaps > 0 ? '#f59e0b' : '#22c55e'} subtitle="coverage gaps identified" />
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
                  {String(row[key] || '—').slice(0, 50)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
