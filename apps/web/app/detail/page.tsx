'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../../components/layout/TopAppBar';

export default function DetailPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        // Check if data exists first
        const statusRes = await fetch('/api/cache-status');
        const statusData = await statusRes.json();

        if (!statusData.has_data) {
          setError('No data available. Run refresh first.');
          return;
        }

        // Fetch detail data (all tables)
        const [decisions, fields, security, quality, audit] = await Promise.all([
          fetch('/api/agent-decisions').then(r => r.json()),
          fetch('/api/field-usage').then(r => r.json()),
          fetch('/api/security-coverage').then(r => r.json()),
          fetch('/api/quality-hotspots').then(r => r.json()),
          fetch('/api/search-audit').then(r => r.json()),
        ]);

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

    fetch();
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar cacheStatus={null} />

      <div style={{ padding: '1.25rem', maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', marginBottom: '1.5rem' }}>Telemetry Detail Dashboard</h1>

        {error && (
          <div style={{ padding: '1rem', background: '#7f1d1d', color: '#fca5a5', borderRadius: 8, marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#64748b' }}>Loading detail data…</div>
        ) : (
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
      </div>
    </main>
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
