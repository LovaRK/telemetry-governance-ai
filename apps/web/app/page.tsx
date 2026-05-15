'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../components/layout/TopAppBar';
import ExecutiveOverview from '../components/dashboard/ExecutiveOverview';
import ValueWasteMatrix from '../components/dashboard/ValueWasteMatrix';
import SourceIntelligenceGrid from '../components/dashboard/SourceIntelligenceGrid';
import AgentIntelligencePanel from '../components/dashboard/AgentIntelligencePanel';
import EmptyState from '../components/state/EmptyState';
import { DashboardData } from '../lib/types';
import { toDashboardAssets } from '../lib/mappers';

type Tab = 'overview' | 'telemetry' | 'recommendations';

type CacheStatus = {
  status: string;
  isStale: boolean;
  lastRefreshAt: string | null;
  recordCount: number;
};

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [formData, setFormData] = useState({ mcp_url: '', token: '', disable_ssl_verify: true });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [telemetryRes, cacheRes] = await Promise.all([
        fetch('/api/telemetry'),
        fetch('/api/cache?key=index_metrics')
      ]);

      if (!telemetryRes.ok) {
        console.error('Telemetry fetch failed:', telemetryRes.status, telemetryRes.statusText);
        setData(null);
        setLoading(false);
        return;
      }

      const [telemetry, cache] = await Promise.all([
        telemetryRes.json(),
        cacheRes.json()
      ]);

      console.log('Telemetry data received:', telemetry);

      if (!telemetry?.snapshots || telemetry.snapshots.length === 0) {
        setData(null);
      } else {
        setData({
          telemetry_assets: telemetry.snapshots,
          kpis: telemetry.kpis,
          requiresRefresh: false,
        });
      }

      setCacheStatus(cache);
    } catch (e) {
      console.error('Failed to fetch data:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const telemetryRes = await fetch('/api/telemetry');
        const cacheRes = await fetch('/api/cache?key=index_metrics');

        const telemetry = await telemetryRes.json();
        const cache = await cacheRes.json();

        if (telemetry?.snapshots && telemetry.snapshots.length > 0) {
          setData({
            telemetry_assets: telemetry.snapshots,
            kpis: telemetry.kpis,
            requiresRefresh: false,
          });
        } else {
          setData(null);
        }

        setCacheStatus(cache);
      } catch (e) {
        console.error('Init fetch failed:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleRefresh = async () => {
    if (loading || !formData.mcp_url || !formData.token) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcpUrl: formData.mcp_url,
          token: formData.token,
          disableSslVerify: formData.disable_ssl_verify
        })
      });

      if (!res.ok) {
        const err = await res.json();
        const parts = [err.error, err.reason, err.hint].filter(Boolean);
        setError(parts.join(' — '));
        return;
      }

      await fetchData();
    } catch (e: any) {
      console.error('Refresh failed:', e);
      setError(e.message || 'Refresh failed');
    } finally {
      setLoading(false);
    }
  };

  const hasData = data !== null && (data?.telemetry_assets?.length ?? 0) > 0;

  // Fallback: fetch data directly if component state is null
  const [fallbackAttempted, setFallbackAttempted] = useState(false);
  useEffect(() => {
    if (data === null && !loading && !fallbackAttempted) {
      setFallbackAttempted(true);
      const directFetch = async () => {
        try {
          const res = await fetch('/api/telemetry');
          if (res.ok) {
            const telemetry = await res.json();
            if (telemetry?.snapshots?.length > 0) {
              setData({
                telemetry_assets: telemetry.snapshots,
                kpis: telemetry.kpis,
                requiresRefresh: false,
              });
            }
          }
        } catch (e) {
          console.error('Direct fetch failed:', e);
        }
      };
      directFetch();
    }
  }, [fallbackAttempted, data, loading]);

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <TopAppBar
        cacheStatus={cacheStatus}
        onRefresh={handleRefresh}
        loading={loading}
        hasConfig={!!formData.mcp_url && !!formData.token}
      />

      <div style={{ padding: '1rem', maxWidth: 1400, margin: '0 auto' }}>
        {cacheStatus?.isStale && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              background: '#f59e0b15',
              border: '1px solid #f59e0b40',
              borderRadius: '8px',
              color: '#f59e0b',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            ⚠ Data is stale. Refresh recommended for up-to-date recommendations.
          </div>
        )}

        {cacheStatus?.status === 'error' && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              background: '#ef444415',
              border: '1px solid #ef444440',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '0.875rem'
            }}
          >
            ⚠ Warning: Data may be incomplete. Some indices may have failed during last refresh.
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '1rem',
              background: '#fef2f2',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              color: '#ef4444'
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px' }}>
          <h2 style={{ marginBottom: '1rem', color: '#f8fafc' }}>Connect to Splunk MCP</h2>
          <p style={{ color: '#9ca3af', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Enter your Splunk MCP credentials to fetch and aggregate telemetry data.
            Data will be cached in PostgreSQL for fast display.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="MCP URL (e.g., http://localhost:3000)"
              value={formData.mcp_url}
              onChange={(e) => setFormData((prev) => ({ ...prev, mcp_url: e.target.value }))}
              style={{ flex: 1, minWidth: '250px', padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
            />
            <input
              type="password"
              placeholder="Token"
              value={formData.token}
              onChange={(e) => setFormData((prev) => ({ ...prev, token: e.target.value }))}
              style={{ flex: 1, minWidth: '200px', padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
            />
            <button
              onClick={handleRefresh}
              disabled={loading || !formData.mcp_url || !formData.token}
              style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: loading || !formData.mcp_url || !formData.token ? 0.5 : 1 }}
            >
              {loading ? 'Refreshing...' : 'Fetch & Cache'}
            </button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', color: '#cbd5e1', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={formData.disable_ssl_verify}
              onChange={(e) => setFormData((prev) => ({ ...prev, disable_ssl_verify: e.target.checked }))}
            />
            Disable SSL verification (for self-signed certs)
          </label>
        </div>

        {data === null && <EmptyState onRefresh={handleRefresh} loading={loading} />}

        {hasData && (
          <>
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.5rem 0.75rem',
                background: '#22c55e15',
                borderRadius: '6px',
                color: '#22c55e',
                fontSize: '0.75rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem'
              }}
            >
              ✓ Data loaded successfully
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {(['overview', 'telemetry', 'recommendations'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: activeTab === tab ? '#3b82f6' : 'transparent',
                    color: activeTab === tab ? '#fff' : '#94a3b8',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  {tab === 'overview' ? 'Overview' : tab === 'telemetry' ? 'Telemetry Intelligence' : 'Recommendations'}
                </button>
              ))}
            </div>

            {activeTab === 'overview' && (
              <>
                <ExecutiveOverview
                  kpis={data.kpis || { totalIndices: 0, totalSourcetypes: 0, totalPotentialSavings: 0, avgConfidence: 0, highRiskCount: 0 }}
                  summary={data.summary || { totalAssets: 0, totalPotentialSavings: 0 }}
                />
                <AgentIntelligencePanel />
                <ValueWasteMatrix assets={toDashboardAssets(data.telemetry_assets || [])} />
              </>
            )}

            {activeTab === 'telemetry' && <SourceIntelligenceGrid assets={toDashboardAssets(data.telemetry_assets || [])} />}

            {activeTab === 'recommendations' && data?.summary && (
              <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>Recommendation Summary</h3>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <div><span style={{ color: '#22c55e' }}>●</span> KEEP: {data.summary.keep || 0}</div>
                  <div><span style={{ color: '#f59e0b' }}>●</span> OPTIMIZE: {data.summary.optimize || 0}</div>
                  <div><span style={{ color: '#3b82f6' }}>●</span> ARCHIVE: {data.summary.archive || 0}</div>
                  <div><span style={{ color: '#ef4444' }}>●</span> ELIMINATE: {data.summary.eliminate || 0}</div>
                  <div><span style={{ color: '#8b5cf6' }}>●</span> INVESTIGATE: {data.summary.investigate || 0}</div>
                </div>
                {data.summary.totalPotentialSavings > 0 && (
                  <div style={{ marginTop: '1rem', fontWeight: 600, color: '#22c55e', fontSize: '1.125rem' }}>
                    Total Potential Savings: ${(data.summary.totalPotentialSavings / 1000).toFixed(0)}k/year
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
