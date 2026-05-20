'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../components/layout/TopAppBar';
import ExecutiveOverview from '../components/dashboard/ExecutiveOverview';
import AgentIntelligencePanel from '../components/dashboard/AgentIntelligencePanel';
import SourceIntelligenceGrid from '../components/dashboard/SourceIntelligenceGrid';
import ConnectionGatedUI from '../components/shared/ConnectionGatedUI';
import ConfigPanel from '../components/dashboard/ConfigPanel';
import { DecisionReviewQueue } from '../components/DecisionReviewQueue';
import { QueueHealthMetrics } from '../components/QueueHealthMetrics';
import { ModelHealthMonitor } from '../components/ModelHealthMonitor';
import { UserProvider } from '../lib/user-context';
import { ExecutiveSummary, CacheStatus } from '../lib/types';
import { apiFetch } from '../lib/api-client';
import { useAuthGuard } from '../lib/use-auth-guard';
import DecisionExplainabilityPanel from '../components/dashboard/DecisionExplainabilityPanel';
import GovernanceWorkflowPanel from '../components/dashboard/GovernanceWorkflowPanel';
import DriftAlertFeed from '../components/dashboard/DriftAlertFeed';
import SourcetypeRiskHeatmap from '../components/dashboard/SourcetypeRiskHeatmap';
import LiveCacheCoherenceMonitor from '../components/dashboard/LiveCacheCoherenceMonitor';
import MutationLifecycleTimeline from '../components/dashboard/MutationLifecycleTimeline';
import JobStatusToast from '../components/shared/JobStatusToast';
import { useGovernanceStream } from '../lib/use-governance-stream';
import { GovernanceToastNotification, useGovernanceToastManager } from '../components/dashboard/GovernanceToastNotification';
import { ToastProvider } from '../lib/toast-context';

type Tab = 'overview' | 'telemetry' | 'governance';

function Home() {
  useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [formData, setFormData] = useState({
    mcp_url: '',
    auth_type: 'basic' as 'token' | 'basic',
    token: '',
    username: '',
    password: '',
    disable_ssl_verify: true,
  });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pendingDecisionCount, setPendingDecisionCount] = useState(0);

  // Toast notification manager
  const toastManager = useGovernanceToastManager();

  // SSE live stream — auto-refresh summary when governance events arrive
  const { connected: streamConnected, lastHeartbeat } = useGovernanceStream({
    enabled: !loading,
    onGovernance: (e) => {
      // A recommendation was approved/rejected — refresh summary to sync badges
      fetchSummary();
      // Show toast notification
      toastManager.onGovernanceEvent(e);
    },
    onDecision: (e) => {
      // New LLM decisions from a fresh aggregation run
      fetchSummary();
      // Show toast notification
      toastManager.onDecisionEvent(e);
    },
    onDrift: (e) => {
      // Drift detected — show toast
      toastManager.onDriftEvent(e);
    },
  });

  const fetchSummary = async () => {
    try {
      const statusRes = await apiFetch('/api/cache-status');
      if (!statusRes.ok) {
        console.error('Cache status request failed:', statusRes.status, statusRes.statusText);
        setError(`Failed to load cache status: ${statusRes.status} ${statusRes.statusText}`);
        setSummary(null);
        return;
      }

      const response = await statusRes.json();
      const statusData: CacheStatus = response.data || response;
      setCacheStatus(statusData);

      // GATE: only load dashboard if a real Splunk refresh has ever run
      if (!statusData.hasEverRefreshed) {
        setSummary(null);
        return;
      }

      const summaryRes = await apiFetch('/api/executive-summary');
      if (!summaryRes.ok) {
        console.error('Executive summary request failed:', summaryRes.status);
        setSummary(null);
        return;
      }

      const summaryResponse = await summaryRes.json();
      const summaryData = summaryResponse.data || summaryResponse;
      if (summaryData?.snapshots?.length > 0) {
        setSummary(summaryData as ExecutiveSummary);
      } else {
        setSummary(null);
      }
    } catch (e) {
      console.error('Failed to fetch summary:', e);
      setError(`Error loading dashboard: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setSummary(null);
    }
  };

  const fetchPendingDecisionsCount = async () => {
    try {
      const res = await apiFetch('/api/decision-lineage?limit=1');
      const result = await res.json();
      if (result.mode === 'FULL_STACK' && Array.isArray(result.data)) {
        setPendingDecisionCount(result.data.length);
      }
    } catch (e) {
      console.error('Failed to fetch pending decisions count:', e);
    }
  };

  useEffect(() => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem('splunk_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setFormData({
          mcp_url: parsed.mcpUrl || '',
          auth_type: parsed.authType || 'basic',
          token: parsed.token || '',
          username: parsed.username || '',
          password: parsed.password || '',
          disable_ssl_verify: parsed.disableSslVerify !== undefined ? parsed.disableSslVerify : true,
        });
      } catch {
        // Invalid config, ignore
      }
    }
    fetchSummary().finally(() => setLoading(false));
    fetchPendingDecisionsCount();
  }, []);

  const canRefresh = formData.mcp_url &&
    (formData.auth_type === 'token' ? !!formData.token : (!!formData.username && !!formData.password));

  const handleRefresh = async () => {
    if (refreshing || !canRefresh) return;
    setRefreshing(true);
    setError(null);

    // Save config to localStorage for next visit
    localStorage.setItem('splunk_config', JSON.stringify({
      mcpUrl: formData.mcp_url,
      authType: formData.auth_type,
      token: formData.token,
      username: formData.username,
      password: formData.password,
      disableSslVerify: formData.disable_ssl_verify,
    }));

    const body: Record<string, unknown> = {
      mcpUrl: formData.mcp_url,
      disableSslVerify: formData.disable_ssl_verify,
    };
    if (formData.auth_type === 'token') {
      body.token = formData.token;
    } else {
      body.username = formData.username;
      body.password = formData.password;
    }

    try {
      const res = await apiFetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        const parts = [err.error, err.reason, err.hint].filter(Boolean);
        setError(parts.join(' — '));
        return;
      }
      const result = await res.json();
      if (result.jobId) setActiveJobId(result.jobId);
      await fetchSummary();
      await fetchPendingDecisionsCount();
    } catch (e: any) {
      setError(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const hasData = summary !== null && summary.snapshots.length > 0;

  // ── CSV export ────────────────────────────────────────────────────────────
  const downloadCSV = (type: 'snapshots' | 'decisions') => {
    if (!summary) return;
    let csv = '';
    if (type === 'snapshots') {
      const cols = ['indexName', 'sourcetype', 'tier', 'action', 'dailyGb', 'utilizationScore', 'detectionScore', 'qualityScore', 'compositeScore', 'estimatedSavings', 'isQuickWin', 'confidenceScore'];
      csv = [cols.join(','), ...summary.snapshots.map(r => cols.map(c => JSON.stringify((r as any)[c] ?? '')).join(','))].join('\n');
    } else {
      const cols = ['indexName', 'sourcetype', 'tier', 'action', 'compositeScore', 'confidenceScore', 'reasoning', 'governanceStatus'];
      csv = [cols.join(','), ...(summary.decisions || []).map(r => cols.map(c => JSON.stringify((r as any)[c] ?? '')).join(','))].join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `datasensai-${type}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
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
            <input type="text" placeholder="Splunk URL (e.g., https://splunk:8089)"
              value={formData.mcp_url} onChange={(e) => setFormData(p => ({ ...p, mcp_url: e.target.value }))}
              style={inputStyle} />
            <select value={formData.auth_type}
              onChange={(e) => setFormData(p => ({ ...p, auth_type: e.target.value as 'token' | 'basic' }))}
              style={{ ...inputStyle, cursor: 'pointer', flex: 'none' }}>
              <option value="basic">Basic Auth (username + password)</option>
              <option value="token">Token</option>
            </select>
            {formData.auth_type === 'basic' ? (
              <>
                <input type="text" placeholder="Username"
                  value={formData.username} onChange={(e) => setFormData(p => ({ ...p, username: e.target.value }))}
                  style={inputStyle} />
                <input type="password" placeholder="Password"
                  value={formData.password} onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))}
                  style={inputStyle} />
              </>
            ) : (
              <input type="password" placeholder="API Token"
                value={formData.token} onChange={(e) => setFormData(p => ({ ...p, token: e.target.value }))}
                style={inputStyle} />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
              <input type="checkbox" checked={formData.disable_ssl_verify}
                onChange={(e) => setFormData(p => ({ ...p, disable_ssl_verify: e.target.checked }))} />
              Skip SSL verification (required for self-signed certs)
            </label>
            {error && (
              <div style={{ padding: '0.75rem', background: '#7f1d1d20', border: '1px solid #ef444440', borderRadius: 8, color: '#ef4444', fontSize: '0.8rem' }}>
                {error}
              </div>
            )}
            <button onClick={handleRefresh} disabled={refreshing || !canRefresh}
              style={{ padding: '0.75rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 8, cursor: refreshing || !canRefresh ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: !canRefresh ? 0.5 : 1 }}>
              {refreshing ? '⟳ Running LLM pipeline… (up to 5 min)' : '↺ Connect & Refresh'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Main app (refresh has run at least once) ─────────────────────────────
  const mainContent = (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar cacheStatus={cacheStatus} onRefresh={handleRefresh} loading={refreshing} hasConfig={!!formData.mcp_url && !!canRefresh} />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>

        {/* Compact connection bar */}
        <div style={{ marginBottom: '1.5rem', padding: '0.625rem 1rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          {formData.mcp_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formData.mcp_url} ({formData.auth_type === 'basic' ? `Basic: ${formData.username}` : 'Token'})
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
              <input type="text" placeholder="Splunk URL" value={formData.mcp_url}
                onChange={(e) => setFormData(p => ({ ...p, mcp_url: e.target.value }))}
                style={{ ...inputStyle, minWidth: 200 }} />
              <select value={formData.auth_type}
                onChange={(e) => setFormData(p => ({ ...p, auth_type: e.target.value as 'token' | 'basic' }))}
                style={{ ...inputStyle, flex: 'none', width: 120, cursor: 'pointer' }}>
                <option value="basic">Basic Auth</option>
                <option value="token">Token</option>
              </select>
              {formData.auth_type === 'basic' ? (
                <>
                  <input type="text" placeholder="User" value={formData.username}
                    onChange={(e) => setFormData(p => ({ ...p, username: e.target.value }))}
                    style={{ ...inputStyle, maxWidth: 120 }} />
                  <input type="password" placeholder="Pass" value={formData.password}
                    onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))}
                    style={{ ...inputStyle, maxWidth: 120 }} />
                </>
              ) : (
                <input type="password" placeholder="Token" value={formData.token}
                  onChange={(e) => setFormData(p => ({ ...p, token: e.target.value }))}
                  style={{ ...inputStyle, maxWidth: 180 }} />
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            {/* SSE live indicator */}
            <div title={streamConnected ? `Live stream connected${lastHeartbeat ? ' · ' + new Date(lastHeartbeat).toLocaleTimeString() : ''}` : 'Stream disconnected'} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: streamConnected ? '#22c55e' : '#475569',
                boxShadow: streamConnected ? '0 0 6px #22c55e80' : 'none',
                display: 'inline-block',
              }} />
              <span style={{ fontSize: '0.62rem', color: streamConnected ? '#22c55e' : '#475569', fontWeight: 600 }}>
                {streamConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
            {refreshing && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Running LLM pipeline…</span>}
            <button onClick={handleRefresh} disabled={refreshing || !canRefresh}
              style={{ padding: '0.375rem 0.875rem', background: refreshing ? '#1e293b' : '#3b82f6', color: refreshing ? '#64748b' : '#fff', border: 'none', borderRadius: 6, cursor: refreshing || !canRefresh ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
              {refreshing ? '⟳ Fetching…' : '↺ Refresh'}
            </button>
            <button onClick={() => setConfigPanelOpen(true)}
              style={{ padding: '0.375rem 0.625rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ⚙️
            </button>
            {formData.mcp_url && (
              <button onClick={() => { localStorage.removeItem('splunk_config'); setFormData({ mcp_url: '', auth_type: 'basic', token: '', username: '', password: '', disable_ssl_verify: true }); }}
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
                {(['overview', 'telemetry', 'governance'] as Tab[]).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    style={{ padding: '0.5rem 1.25rem', background: activeTab === tab ? '#3b82f6' : 'transparent', color: activeTab === tab ? '#fff' : '#64748b', border: activeTab === tab ? 'none' : '1px solid #1e293b', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', position: 'relative' }}>
                    {tab === 'overview' ? 'Executive Overview' : tab === 'telemetry' ? 'Telemetry Detail' : 'Governance'}
                    {tab === 'governance' && pendingDecisionCount > 0 && (
                      <span style={{ position: 'absolute', top: -8, right: -8, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 800 }}>
                        {Math.min(pendingDecisionCount, 9)}
                      </span>
                    )}
                  </button>
                ))}
                <a href="/detail" style={{ padding: '0.5rem 1.25rem', background: 'transparent', color: '#334155', border: '1px solid #1e293b', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  Enhanced Viz ↗
                </a>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {/* Data freshness indicator */}
                  {(() => {
                    const snapDate = summary.snapshotDate ? new Date(summary.snapshotDate) : null;
                    const ageMs = snapDate ? Date.now() - snapDate.getTime() : null;
                    const ageHrs = ageMs != null ? Math.floor(ageMs / 3_600_000) : null;
                    const fresh = ageHrs != null && ageHrs < 24;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: fresh ? '#22c55e' : '#f59e0b', boxShadow: fresh ? '0 0 5px #22c55e80' : 'none' }} />
                        <span style={{ fontSize: '0.68rem', color: fresh ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                          {ageHrs == null ? 'Unknown age' : ageHrs < 1 ? 'Fresh' : ageHrs < 24 ? `${ageHrs}h ago` : `${Math.floor(ageHrs/24)}d ago`}
                        </span>
                      </div>
                    );
                  })()}
                  <span style={{ color: '#1e293b' }}>·</span>
                  <span style={{ fontSize: '0.7rem', color: '#334155' }}>{summary.snapshots.length} indexes</span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => downloadCSV('snapshots')}
                    title="Export snapshot data as CSV"
                    style={{ padding: '0.3rem 0.6rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    ↓ Snapshots
                  </button>
                  {(summary.decisions?.length ?? 0) > 0 && (
                    <button onClick={() => downloadCSV('decisions')}
                      title="Export LLM decisions as CSV"
                      style={{ padding: '0.3rem 0.6rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      ↓ Decisions
                    </button>
                  )}
                </div>
              </div>
            </div>

            {activeTab === 'overview' && (
              <>
                <AgentIntelligencePanel snapshots={summary.snapshots} kpis={summary.kpis} hasAgentDecisions={hasAgentDecisions} />
                <ExecutiveOverview summary={summary} hasAgentDecisions={hasAgentDecisions} />
                {hasAgentDecisions && summary.decisions && summary.decisions.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <DecisionExplainabilityPanel decisions={summary.decisions} />
                  </div>
                )}
              </>
            )}

            {activeTab === 'telemetry' && (
              <SourceIntelligenceGrid snapshots={summary.snapshots} hasAgentDecisions={hasAgentDecisions} />
            )}

            {activeTab === 'governance' && (
              <div style={{ display: 'grid', gap: '1.5rem' }}>
                {/* Live Cache Coherence Monitor */}
                <LiveCacheCoherenceMonitor />

                {/* Drift & Governance Alert Feed */}
                <DriftAlertFeed />

                {/* Sourcetype Risk Heatmap */}
                <SourcetypeRiskHeatmap snapshots={summary.snapshots} />

                {/* Mutation Lifecycle Timeline */}
                <MutationLifecycleTimeline />

                {/* Human Governance Workflow — primary governance surface */}
                <GovernanceWorkflowPanel snapshotId={summary?.snapshots?.[0]?.snapshotId} />

                <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', padding: '1rem', border: '1px solid #1e293b' }}>
                  <ModelHealthMonitor />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1rem' }}>Queue Health</h3>
                  <QueueHealthMetrics />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1rem' }}>Decision Review Queue</h3>
                  <DecisionReviewQueue />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ConfigPanel isOpen={configPanelOpen} onClose={() => setConfigPanelOpen(false)} />
    </main>
  );

  // Wrap dashboard with connection gating
  return (
    <>
      <UserProvider>
        <ConnectionGatedUI>
          {loading ? (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#64748b' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⟳</div>
                <p>Loading dashboard...</p>
              </div>
            </div>
          ) : !cacheStatus?.hasEverRefreshed ? (
            // Connection screen falls back to inline form in mainContent
            <>{mainContent}</>
          ) : (
            mainContent
          )}
        </ConnectionGatedUI>
      </UserProvider>
      {activeJobId && (
        <JobStatusToast
          jobId={activeJobId}
          onComplete={() => {
            setActiveJobId(null);
            fetchSummary();
          }}
        />
      )}
      <GovernanceToastNotification position="top-right" maxVisible={3} />
    </>
  );
}

// Wrap the main app with providers
const PageWithProviders = () => {
  return (
    <ToastProvider>
      <Home />
    </ToastProvider>
  );
}

export default PageWithProviders;

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
