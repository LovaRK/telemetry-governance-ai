'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../components/layout/TopAppBar';
import ExecutiveOverview from '../components/dashboard/ExecutiveOverview';
import AgentIntelligencePanel from '../components/dashboard/AgentIntelligencePanel';
import SourceIntelligenceGrid from '../components/dashboard/SourceIntelligenceGrid';
import EmptyState from '../components/state/EmptyState';
import { ExecutiveSummary, CacheStatus } from '../lib/types';

type Tab = 'overview' | 'telemetry';

const EMPTY_KPIS = {
  roiScore: 0, gainScopeScore: 0, totalLicenseSpend: 0, licenseSpendLowValue: 0,
  storageSavingsPotential: 0, totalDailyGb: 0, totalSourcetypes: 0,
  tierCounts: { critical: 0, important: 0, niceToHave: 0, lowValue: 0 },
  securityGaps: 0, operationalGaps: 0,
  avgUtilization: 0, avgDetection: 0, avgQuality: 0, avgConfidence: 0,
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [formData, setFormData] = useState({ mcp_url: '', token: '', disable_ssl_verify: true });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      // CRITICAL: Check if data exists first
      const statusRes = await fetch('/api/cache-status');
      const statusData = await statusRes.json();
      setCacheStatus(statusData);

      // If no data, don't try to load dashboard
      if (!statusData.has_data) {
        setSummary(null);
        return;
      }

      // Data exists, fetch the actual summary
      const summaryRes = await fetch('/api/executive-summary');
      if (!summaryRes.ok) {
        setSummary(null);
        return;
      }

      const data = await summaryRes.json();
      if (data?.snapshots?.length > 0) {
        setSummary(data as ExecutiveSummary);
      } else {
        setSummary(null);
      }
    } catch (e) {
      console.error('Failed to fetch summary:', e);
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchSummary().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    if (refreshing || !formData.mcp_url || !formData.token) return;

    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcpUrl: formData.mcp_url,
          token: formData.token,
          disableSslVerify: formData.disable_ssl_verify,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const parts = [err.error, err.reason, err.hint].filter(Boolean);
        setError(parts.join(' — '));
        return;
      }

      await fetchSummary();
    } catch (e: any) {
      setError(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const hasConfig = !!(formData.mcp_url.trim() && formData.token.trim());
  const hasData = summary !== null && summary.snapshots.length > 0;

  return (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar
        cacheStatus={cacheStatus}
        onRefresh={handleRefresh}
        loading={refreshing}
        hasConfig={!!formData.mcp_url && !!formData.token}
      />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>

        {/* Splunk connection — compact bar when configured, full form when not */}
        {hasConfig ? (
          <div style={{ marginBottom: '1.5rem', padding: '0.625rem 1rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Connected — <span style={{ color: '#64748b' }}>{formData.mcp_url}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
              {refreshing && (
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Running LLM pipeline… (up to 5 min)</span>
              )}
              <button onClick={handleRefresh} disabled={refreshing}
                style={{ padding: '0.375rem 0.875rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 6, cursor: refreshing ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {refreshing ? '⟳ Fetching…' : '↺ Refresh'}
              </button>
              <button onClick={() => setFormData({ mcp_url: '', token: '', disable_ssl_verify: true })}
                style={{ padding: '0.375rem 0.625rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem' }}>
                Change
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '1.5rem', padding: '1.25rem 1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Connect to Splunk
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="text" placeholder="Splunk MCP URL (e.g., http://splunk:8089)"
                value={formData.mcp_url} onChange={(e) => setFormData((p) => ({ ...p, mcp_url: e.target.value }))}
                style={inputStyle} />
              <input type="password" placeholder="Token"
                value={formData.token} onChange={(e) => setFormData((p) => ({ ...p, token: e.target.value }))}
                style={{ ...inputStyle, maxWidth: 200 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={formData.disable_ssl_verify}
                  onChange={(e) => setFormData((p) => ({ ...p, disable_ssl_verify: e.target.checked }))} />
                Skip SSL
              </label>
              <button onClick={handleRefresh} disabled={refreshing || !formData.mcp_url || !formData.token}
                style={{ padding: '0.625rem 1.25rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 8, cursor: refreshing || !formData.mcp_url || !formData.token ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', opacity: !formData.mcp_url || !formData.token ? 0.5 : 1 }}>
                {refreshing ? '⟳ Fetching…' : '↺ Connect & Refresh'}
              </button>
            </div>
            {refreshing && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
                Running LLM decision pipeline — this may take up to 5 minutes…
              </div>
            )}
          </div>
        )}

        {/* Alerts */}
        {cacheStatus?.isStale && !error && (
          <div style={alertStyle('#f59e0b')}>
            ⚠ Data may be stale. Refresh recommended.
          </div>
        )}
        {error && (
          <div style={alertStyle('#ef4444')}>
            ✕ {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#475569', fontSize: '0.875rem' }}>
            Loading data…
          </div>
        )}

        {/* Empty state */}
        {!loading && !hasData && (
          <EmptyState onRefresh={handleRefresh} loading={refreshing} />
        )}

        {/* Dashboard */}
        {!loading && hasData && summary && (
          <>
            {/* Header bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['overview', 'telemetry'] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '0.5rem 1.25rem',
                      background: activeTab === tab ? '#3b82f6' : 'transparent',
                      color: activeTab === tab ? '#fff' : '#64748b',
                      border: activeTab === tab ? 'none' : '1px solid #1e293b',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {tab === 'overview' ? 'Executive Overview' : 'Telemetry Intelligence'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#334155' }}>
                {summary.snapshots.length} indexes · {summary.snapshotDate ? new Date(summary.snapshotDate).toLocaleDateString() : ''}
              </div>
            </div>

            {activeTab === 'overview' && (
              <>
                <AgentIntelligencePanel snapshots={summary.snapshots} kpis={summary.kpis} />
                <ExecutiveOverview summary={summary} />
              </>
            )}

            {activeTab === 'telemetry' && (
              <SourceIntelligenceGrid snapshots={summary.snapshots} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 240,
  padding: '0.625rem 0.875rem',
  background: '#0a0f1a',
  border: '1px solid #1e293b',
  color: '#f8fafc',
  borderRadius: 8,
  fontSize: '0.8rem',
};

function alertStyle(color: string): React.CSSProperties {
  return {
    marginBottom: '1rem',
    padding: '0.75rem 1rem',
    background: `${color}15`,
    border: `1px solid ${color}40`,
    borderRadius: 8,
    color,
    fontSize: '0.8rem',
  };
}
