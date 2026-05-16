'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../components/layout/TopAppBar';
import ExecutiveOverview from '../components/dashboard/ExecutiveOverview';
import AgentIntelligencePanel from '../components/dashboard/AgentIntelligencePanel';
import SourceIntelligenceGrid from '../components/dashboard/SourceIntelligenceGrid';
import ConfigPanel from '../components/ConfigPanel';
import { ExecutiveSummary, CacheStatus } from '../lib/types';

type Tab = 'overview' | 'telemetry';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [formData, setFormData] = useState({
    mcp_url: '',
    authType: 'token' as 'token' | 'basic',
    token: '',
    username: '',
    password: '',
    disable_ssl_verify: true
  });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);

  const fetchSummary = async () => {
    try {
      const statusRes = await fetch('/api/cache-status');
      const statusData: CacheStatus = await statusRes.json();
      setCacheStatus(statusData);

      // GATE: only load dashboard if a real Splunk refresh has ever run
      if (!statusData.hasEverRefreshed) {
        setSummary(null);
        return;
      }

      const summaryRes = await fetch('/api/executive-summary');
      if (!summaryRes.ok) { setSummary(null); return; }

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

  useEffect(() => { fetchSummary().finally(() => setLoading(false)); }, []);

  const handleRefresh = async () => {
    const hasAuth = formData.authType === 'token'
      ? formData.token
      : (formData.username && formData.password);

    if (refreshing || !formData.mcp_url || !hasAuth) return;
    setRefreshing(true);
    setError(null);
    try {
      const payload: any = {
        mcpUrl: formData.mcp_url,
        disableSslVerify: formData.disable_ssl_verify,
      };

      if (formData.authType === 'token') {
        payload.token = formData.token;
      } else {
        payload.username = formData.username;
        payload.password = formData.password;
      }

      const res = await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  const hasData = summary !== null && summary.snapshots.length > 0;
  const hasAgentDecisions = cacheStatus?.hasAgentDecisions ?? false;
  const isStale = cacheStatus?.status === 'stale';

  // ── Connection screen (no refresh has ever run) ──────────────────────────
  if (!loading && !cacheStatus?.hasEverRefreshed) {
    return (
      <main style={{ minHeight: '100vh', background: '#050a14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: '1.25rem', margin: '0 auto 1rem' }}>d</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>datasensAI</div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Connect to Splunk to get started</div>
        </div>

        <div style={{ width: '100%', maxWidth: 540, padding: '2rem', background: '#0f172a', borderRadius: 16, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '1.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Splunk Connection
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="Splunk URL (e.g., https://splunk.example.com:8089)"
              value={formData.mcp_url} onChange={(e) => setFormData(p => ({ ...p, mcp_url: e.target.value }))}
              style={inputStyle} />

            {/* Auth Type Selector */}
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: formData.authType === 'token' ? '#3b82f6' : '#64748b', cursor: 'pointer', flex: 1, padding: '0.5rem', background: formData.authType === 'token' ? '#1e293b' : 'transparent', borderRadius: 6, border: '1px solid', borderColor: formData.authType === 'token' ? '#3b82f6' : '#334155' }}>
                <input type="radio" name="authType" value="token" checked={formData.authType === 'token'} onChange={() => setFormData(p => ({ ...p, authType: 'token' }))} style={{ cursor: 'pointer' }} />
                Token (Recommended)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: formData.authType === 'basic' ? '#3b82f6' : '#64748b', cursor: 'pointer', flex: 1, padding: '0.5rem', background: formData.authType === 'basic' ? '#1e293b' : 'transparent', borderRadius: 6, border: '1px solid', borderColor: formData.authType === 'basic' ? '#3b82f6' : '#334155' }}>
                <input type="radio" name="authType" value="basic" checked={formData.authType === 'basic'} onChange={() => setFormData(p => ({ ...p, authType: 'basic' }))} style={{ cursor: 'pointer' }} />
                Username & Password
              </label>
            </div>

            {/* Token Auth Fields */}
            {formData.authType === 'token' && (
              <input type="password" placeholder="Splunk Token"
                value={formData.token} onChange={(e) => setFormData(p => ({ ...p, token: e.target.value }))}
                style={inputStyle} />
            )}

            {/* Basic Auth Fields */}
            {formData.authType === 'basic' && (
              <>
                <input type="text" placeholder="Username"
                  value={formData.username} onChange={(e) => setFormData(p => ({ ...p, username: e.target.value }))}
                  style={inputStyle} />
                <input type="password" placeholder="Password"
                  value={formData.password} onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))}
                  style={inputStyle} />
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
              <input type="checkbox" checked={formData.disable_ssl_verify}
                onChange={(e) => setFormData(p => ({ ...p, disable_ssl_verify: e.target.checked }))} />
              Skip SSL verification
            </label>
            {error && (
              <div style={{ padding: '0.75rem', background: '#7f1d1d20', border: '1px solid #ef444440', borderRadius: 8, color: '#ef4444', fontSize: '0.8rem' }}>
                {error}
              </div>
            )}
            <button onClick={handleRefresh} disabled={refreshing || !formData.mcp_url || (formData.authType === 'token' ? !formData.token : (!formData.username || !formData.password))}
              style={{ padding: '0.75rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 8, cursor: refreshing || !formData.mcp_url ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: !formData.mcp_url ? 0.5 : 1 }}>
              {refreshing ? '⟳ Running LLM pipeline… (up to 5 min)' : '↺ Connect & Refresh'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Main app (refresh has run at least once) ─────────────────────────────
  return (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar cacheStatus={cacheStatus} onRefresh={handleRefresh} onOpenConfig={() => setConfigPanelOpen(true)} loading={refreshing} hasConfig={!!formData.mcp_url && !!formData.token} />

      <ConfigPanel open={configPanelOpen} onClose={() => setConfigPanelOpen(false)} />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>

        {/* Compact connection bar */}
        <div style={{ marginBottom: '1.5rem', padding: '0.625rem 1rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          {formData.mcp_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formData.mcp_url} ({formData.authType === 'token' ? 'Token' : 'Basic'})
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
              <input type="text" placeholder="Splunk URL" value={formData.mcp_url}
                onChange={(e) => setFormData(p => ({ ...p, mcp_url: e.target.value }))}
                style={{ ...inputStyle, minWidth: 180 }} />
              <select value={formData.authType} onChange={(e) => setFormData(p => ({ ...p, authType: e.target.value as 'token' | 'basic' }))}
                style={{ ...inputStyle, maxWidth: 120, padding: '0.5rem 0.625rem' }}>
                <option value="token">Token</option>
                <option value="basic">Basic Auth</option>
              </select>
              {formData.authType === 'token' ? (
                <input type="password" placeholder="Token" value={formData.token}
                  onChange={(e) => setFormData(p => ({ ...p, token: e.target.value }))}
                  style={{ ...inputStyle, maxWidth: 140 }} />
              ) : (
                <>
                  <input type="text" placeholder="User" value={formData.username}
                    onChange={(e) => setFormData(p => ({ ...p, username: e.target.value }))}
                    style={{ ...inputStyle, maxWidth: 100 }} />
                  <input type="password" placeholder="Pass" value={formData.password}
                    onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))}
                    style={{ ...inputStyle, maxWidth: 100 }} />
                </>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            {refreshing && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Running LLM pipeline…</span>}
            <button onClick={handleRefresh} disabled={refreshing}
              style={{ padding: '0.375rem 0.875rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 6, cursor: refreshing ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
              {refreshing ? '⟳ Fetching…' : '↺ Refresh'}
            </button>
            {formData.mcp_url && (
              <button onClick={() => setFormData({ mcp_url: '', authType: 'token', token: '', username: '', password: '', disable_ssl_verify: true })}
                style={{ padding: '0.375rem 0.625rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem' }}>
                Change
              </button>
            )}
          </div>
        </div>

        {/* Stale data warning */}
        {isStale && !error && (
          <div style={alertStyle('#f59e0b')}>⚠ Data is stale — refresh recommended to get current Splunk signals.</div>
        )}

        {/* No LLM decisions warning */}
        {!hasAgentDecisions && hasData && (
          <div style={alertStyle('#f59e0b')}>
            ⚠ LLM decisions have not been generated yet. Intelligence sections (tier classifications, risk scores, recommendations) will be hidden until the pipeline completes a full run.
          </div>
        )}

        {error && <div style={alertStyle('#ef4444')}>✕ {error}</div>}

        {loading && <div style={{ textAlign: 'center', padding: '4rem', color: '#475569', fontSize: '0.875rem' }}>Loading…</div>}

        {/* Dashboard tabs */}
        {!loading && hasData && summary && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['overview', 'telemetry'] as Tab[]).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    style={{ padding: '0.5rem 1.25rem', background: activeTab === tab ? '#3b82f6' : 'transparent', color: activeTab === tab ? '#fff' : '#64748b', border: activeTab === tab ? 'none' : '1px solid #1e293b', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {tab === 'overview' ? 'Executive Overview' : 'Telemetry Detail'}
                  </button>
                ))}
                <a href="/detail" style={{ padding: '0.5rem 1.25rem', background: 'transparent', color: '#334155', border: '1px solid #1e293b', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  Enhanced Viz ↗
                </a>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#334155' }}>
                {summary.snapshots.length} indexes · {summary.snapshotDate ? new Date(summary.snapshotDate).toLocaleDateString() : ''}
              </div>
            </div>

            {activeTab === 'overview' && (
              <>
                <AgentIntelligencePanel snapshots={summary.snapshots} kpis={summary.kpis} hasAgentDecisions={hasAgentDecisions} />
                <ExecutiveOverview summary={summary} hasAgentDecisions={hasAgentDecisions} />
              </>
            )}

            {activeTab === 'telemetry' && (
              <SourceIntelligenceGrid snapshots={summary.snapshots} hasAgentDecisions={hasAgentDecisions} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: '0.5rem 0.875rem',
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
