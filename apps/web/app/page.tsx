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
import EmptyState from '../components/state/EmptyState';
import KPIExplanationPanel from '../components/explainability/KPIExplanationPanel';
import { KPIExplainabilityRecord } from '../lib/types';
import { useExplainability } from '../lib/explainability-context';

type Tab = 'overview' | 'telemetry' | 'governance';
type PipelineStage = 'idle' | 'splunk_fetch' | 'snapshot_write' | 'kpi_aggregation' | 'ai_decisions' | 'governance_sync' | 'dashboard_publish' | 'complete' | 'failed';
type PipelineStatus = 'idle' | 'running' | 'complete' | 'failed';

const PIPELINE_STATE_KEY = 'pipeline_run_state_v1';

function stageFromJobStatus(status: string): PipelineStage {
  if (status === 'failed') return 'failed';
  if (status === 'complete') return 'dashboard_publish';
  return 'ai_decisions';
}

function Home() {
  useAuthGuard();
  const envMcpUrl = process.env.NEXT_PUBLIC_SPLUNK_MCP_URL || '';
  const envToken = process.env.NEXT_PUBLIC_SPLUNK_TOKEN || '';
  const envDisableSsl = (process.env.NEXT_PUBLIC_SPLUNK_DISABLE_SSL_VERIFY || '').toLowerCase() === 'true';
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
  const [showConnectionEditor, setShowConnectionEditor] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pendingDecisionCount, setPendingDecisionCount] = useState(0);
  const [pipelineEvents, setPipelineEvents] = useState<Array<{ ts: string; msg: string; level?: 'info' | 'ok' | 'warn' | 'error' }>>([]);
  const [pipelineRun, setPipelineRun] = useState<{
    runId: string | null;
    startedAt: number | null;
    completedAt: number | null;
    status: PipelineStatus;
    stage: PipelineStage;
  }>({
    runId: null,
    startedAt: null,
    completedAt: null,
    status: 'idle',
    stage: 'idle',
  });
  const [kpiDiffs, setKpiDiffs] = useState<Array<{ label: string; before: number; after: number }>>([]);
  const [pulseTick, setPulseTick] = useState(0);
  const [kpiExplain, setKpiExplain] = useState<KPIExplainabilityRecord[]>([]);
  const [explainabilityCoverage, setExplainabilityCoverage] = useState<{ totalKpis: number; expandableKpis: number; coveragePercent: number; missingProvenance: number; missingConfidence: number; missingFormulas: number } | null>(null);
  const { enabled: explainabilityEnabled } = useExplainability();
  const showExplainabilityPanel =
    process.env.NEXT_PUBLIC_ENABLE_EXPLAINABILITY === 'true' &&
    explainabilityEnabled;

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

      // Handle empty state (no published snapshot yet)
      if (summaryData?.empty === true) {
        // Set summary with empty data structure so component can still render
        setSummary(summaryData);
        return;
      }

      if (summaryData?.snapshots?.length > 0) {
        const prevKpis = summary?.kpis;
        const nextKpis = summaryData.kpis;
        if (prevKpis && nextKpis) {
          const diffs: Array<{ label: string; before: number; after: number }> = [];
          const collect = (label: string, before: number, after: number) => {
            if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
              diffs.push({ label, before, after });
            }
          };
          collect('ROI', prevKpis.roiScore, nextKpis.roiScore);
          collect('Annual Spend', prevKpis.totalLicenseSpend, nextKpis.totalLicenseSpend);
          collect('Savings', prevKpis.storageSavingsPotential, nextKpis.storageSavingsPotential);
          collect('Confidence', prevKpis.avgConfidence, nextKpis.avgConfidence);
          if (diffs.length > 0) {
            setKpiDiffs(diffs);
            setTimeout(() => setKpiDiffs([]), 8000);
          }
        }
        setSummary(summaryData as ExecutiveSummary);
        if (showExplainabilityPanel) {
          try {
            const [explainRes, coverageRes] = await Promise.all([
              apiFetch('/api/executive-summary/explain'),
              apiFetch('/api/explainability/coverage'),
            ]);
            if (explainRes.ok) {
              const explainPayload = await explainRes.json();
              setKpiExplain(explainPayload?.data || []);
            }
            if (coverageRes.ok) {
              const coveragePayload = await coverageRes.json();
              setExplainabilityCoverage(coveragePayload?.data || null);
            }
          } catch {
            setKpiExplain([]);
            setExplainabilityCoverage(null);
          }
        }
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

  const hydrateLatestJob = async () => {
    try {
      const res = await apiFetch('/api/job-status/latest');
      if (!res.ok) return;
      const response = await res.json();
      const job = response?.data;
      if (!job?.jobId || !job?.status) return;

      if (job.status === 'pending' || job.status === 'running' || job.status === 'partial') {
        setActiveJobId(job.jobId);
        setPipelineRun((prev) => ({
          runId: job.jobId,
          startedAt: job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : prev.startedAt),
          completedAt: null,
          status: 'running',
          stage: stageFromJobStatus(job.status),
        }));
        setPipelineEvents((prev) => {
          const msg = 'Resumed in-progress pipeline run after page reload';
          if (prev.some((p) => p.msg === msg)) return prev;
          return [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg, level: 'info' }];
        });
      } else if (job.status === 'complete') {
        setPipelineRun((prev) => ({
          runId: prev.runId || job.jobId,
          startedAt: prev.startedAt || (job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : null)),
          completedAt: job.completedAt ? new Date(job.completedAt).getTime() : (prev.completedAt || Date.now()),
          status: 'complete',
          stage: 'complete',
        }));
      } else if (job.status === 'failed') {
        setPipelineRun((prev) => ({
          runId: prev.runId || job.jobId,
          startedAt: prev.startedAt || (job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : null)),
          completedAt: job.completedAt ? new Date(job.completedAt).getTime() : (prev.completedAt || Date.now()),
          status: 'failed',
          stage: 'failed',
        }));
      }
    } catch (e) {
      console.error('Failed to hydrate latest job state:', e);
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
    } else if (envMcpUrl && envToken) {
      // Fallback to env-provided defaults so Refresh remains usable on first load/demo mode.
      setFormData({
        mcp_url: envMcpUrl,
        auth_type: 'token',
        token: envToken,
        username: '',
        password: '',
        disable_ssl_verify: envDisableSsl,
      });
    }
    try {
      const raw = sessionStorage.getItem(PIPELINE_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.pipelineRun) setPipelineRun(parsed.pipelineRun);
        if (Array.isArray(parsed?.pipelineEvents)) setPipelineEvents(parsed.pipelineEvents);
        if (typeof parsed?.activeJobId === 'string' && parsed.activeJobId) setActiveJobId(parsed.activeJobId);
      }
    } catch {
      // Ignore invalid persisted state
    }

    fetchSummary().finally(() => setLoading(false));
    fetchPendingDecisionsCount();
    hydrateLatestJob();
  }, []);

  useEffect(() => {
    if (pipelineRun.status !== 'running') return;
    const t = setInterval(() => setPulseTick((v) => (v + 1) % 4), 350);
    return () => clearInterval(t);
  }, [pipelineRun.status]);

  const finalizePipelineSuccess = () => {
    setActiveJobId(null);
    fetchSummary();
    setPipelineRun((prev) => ({ ...prev, stage: 'dashboard_publish', status: 'running' }));
    setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: 'Dashboard snapshot published', level: 'ok' }]);
    setTimeout(() => {
      setPipelineRun((prev) => ({ ...prev, stage: 'complete', status: 'complete', completedAt: Date.now() }));
      setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: 'Pipeline completed successfully', level: 'ok' }]);
    }, 350);
  };

  // Reconcile job completion even if SSE misses a final message.
  useEffect(() => {
    if (!activeJobId || pipelineRun.status !== 'running') return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/job-status/${encodeURIComponent(activeJobId)}`);
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        const job = payload?.data;
        if (!job?.status || cancelled) return;
        if (job.status === 'complete') {
          finalizePipelineSuccess();
        } else if (job.status === 'failed') {
          setActiveJobId(null);
          setPipelineRun((prev) => ({ ...prev, stage: 'failed', status: 'failed', completedAt: Date.now() }));
          setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: 'AI decision stage failed', level: 'error' }]);
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeJobId, pipelineRun.status]);

  useEffect(() => {
    try {
      sessionStorage.setItem(PIPELINE_STATE_KEY, JSON.stringify({
        activeJobId,
        pipelineEvents,
        pipelineRun,
      }));
    } catch {
      // Ignore quota/storage restrictions
    }
  }, [activeJobId, pipelineEvents, pipelineRun]);

  const canRefresh = !!formData.mcp_url &&
    (formData.auth_type === 'token' ? !!formData.token : (!!formData.username && !!formData.password));
  const canRefreshFromEnvFallback = !canRefresh && !!envMcpUrl && !!envToken;
  const canRefreshEffective = canRefresh || canRefreshFromEnvFallback;

  const handleRefresh = async () => {
    if (refreshing || !canRefreshEffective) return;
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

    const effectiveMcpUrl = formData.mcp_url || envMcpUrl;
    const effectiveDisableSsl = formData.mcp_url ? formData.disable_ssl_verify : envDisableSsl;
    const body: Record<string, unknown> = {
      mcpUrl: effectiveMcpUrl,
      disableSslVerify: effectiveDisableSsl,
    };
    if (formData.auth_type === 'token' && formData.token) {
      body.token = formData.token;
    } else if (formData.auth_type === 'basic' && formData.username && formData.password) {
      body.username = formData.username;
      body.password = formData.password;
    } else if (envToken) {
      // Final fallback path for demo/profile sessions where only env token is available.
      body.token = envToken;
    } else {
      setError('Missing credentials. Click Change and enter Splunk token or username/password.');
      setRefreshing(false);
      return;
    }

    try {
      const runStart = Date.now();
      const runId = `run-${runStart}`;
      setPipelineRun({
        runId,
        startedAt: runStart,
        completedAt: null,
        status: 'running',
        stage: 'splunk_fetch',
      });
      setPipelineEvents([{ ts: new Date().toLocaleTimeString(), msg: 'Querying Splunk metrics…', level: 'info' }]);

      // Pull latest runtime config so refresh uses current cost model from Config panel.
      const configRes = await apiFetch('/api/config');
      if (configRes.ok) {
        const configJson = await configRes.json();
        const cfg = configJson?.data || configJson;
        if (typeof cfg?.costPerGbPerDay === 'number' && Number.isFinite(cfg.costPerGbPerDay)) {
          body.costPerGbPerDay = cfg.costPerGbPerDay;
        }
      }

      const res = await apiFetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        const parts = [err.error, err.reason, err.hint].filter(Boolean);
        setError(parts.join(' — '));
        setPipelineRun((prev) => ({ ...prev, status: 'failed', stage: 'failed', completedAt: Date.now() }));
        setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `Refresh failed: ${parts.join(' — ')}`, level: 'error' }]);
        return;
      }
      const result = await res.json();
      setPipelineRun((prev) => ({ ...prev, stage: 'snapshot_write' }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `Fetched ${result?.data?.inserted ?? result?.inserted ?? 0} indexes from Splunk`, level: 'ok' }]);
      setPipelineRun((prev) => ({ ...prev, stage: 'kpi_aggregation' }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: 'Aggregating KPI scores…', level: 'info' }]);
      if (result.jobId) setActiveJobId(result.jobId);
      if (result.jobId) {
        setPipelineRun((prev) => ({ ...prev, stage: 'ai_decisions' }));
        setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `AI decision run started (${result.jobId})`, level: 'info' }]);
      }
      await fetchSummary();
      await fetchPendingDecisionsCount();
      setShowConnectionEditor(false);
    } catch (e: any) {
      setError(e.message || 'Refresh failed');
      setPipelineRun((prev) => ({ ...prev, status: 'failed', stage: 'failed', completedAt: Date.now() }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `Refresh failed: ${e.message || 'Unknown error'}`, level: 'error' }]);
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
      <TopAppBar cacheStatus={cacheStatus} loading={refreshing} hasConfig={canRefreshEffective} />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>

        {/* Compact connection bar */}
        <div style={{ marginBottom: '1.5rem', padding: '0.625rem 1rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          {!showConnectionEditor && formData.mcp_url && cacheStatus?.hasEverRefreshed ? (
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
            <button onClick={handleRefresh} disabled={refreshing || !canRefreshEffective}
              title={!canRefreshEffective ? 'Missing credentials. Click Change and enter token or username/password.' : 'Fetch latest live data from Splunk'}
              style={{ padding: '0.375rem 0.875rem', background: (refreshing || !canRefreshEffective) ? '#1e293b' : '#3b82f6', color: (refreshing || !canRefreshEffective) ? '#64748b' : '#fff', border: 'none', borderRadius: 6, cursor: refreshing || !canRefreshEffective ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: canRefreshEffective ? 1 : 0.65 }}>
              {refreshing ? '⟳ Fetching…' : '↺ Refresh'}
            </button>
            <button onClick={() => setConfigPanelOpen(true)}
              style={{ padding: '0.375rem 0.625rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ⚙️
            </button>
            {formData.mcp_url && (
              <button onClick={() => {
                setShowConnectionEditor(true);
                // Keep current values while editing so URL/token flow is smooth.
                if (!formData.mcp_url) {
                  setFormData({ mcp_url: '', auth_type: envToken ? 'token' : 'basic', token: envToken || '', username: '', password: '', disable_ssl_verify: true });
                }
              }}
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

        {!loading && (
          <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {[
                  { key: 'splunk_fetch', label: 'Splunk Fetch' },
                  { key: 'snapshot_write', label: 'Snapshot Write' },
                  { key: 'kpi_aggregation', label: 'KPI Aggregation' },
                  { key: 'ai_decisions', label: 'AI Decisions' },
                  { key: 'governance_sync', label: 'Governance Sync' },
                  { key: 'dashboard_publish', label: 'Publish' },
                  { key: 'complete', label: 'Completed' },
                ].map((s, i) => {
                  const active = pipelineRun.stage === (s.key as any);
                  const isRunning = pipelineRun.status === 'running';
                  const done = ['splunk_fetch', 'snapshot_write', 'kpi_aggregation', 'ai_decisions', 'governance_sync', 'dashboard_publish', 'complete']
                    .indexOf(pipelineRun.stage) >= i;
                  const failed = pipelineRun.status === 'failed' && active;
                  const isCompletedStage = s.key === 'complete' && pipelineRun.status === 'complete';
                  return (
                    <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: failed ? '#ef4444' : (done || isCompletedStage) ? '#22c55e' : (active && isRunning) ? '#3b82f6' : '#334155',
                        boxShadow: active && isRunning ? `0 0 ${6 + pulseTick * 3}px #3b82f680` : 'none',
                        transform: active && isRunning ? `scale(${1 + pulseTick * 0.05})` : 'scale(1)',
                        transition: 'all 180ms ease',
                      }} />
                      <span style={{ fontSize: '0.7rem', color: active && isRunning ? '#dbeafe' : (done || isCompletedStage) ? '#86efac' : '#64748b', fontWeight: 600 }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                {pipelineRun.runId
                  ? `Run ${pipelineRun.runId} · Started ${pipelineRun.startedAt ? new Date(pipelineRun.startedAt).toLocaleTimeString() : '--'}${pipelineRun.completedAt ? ` · Completed ${new Date(pipelineRun.completedAt).toLocaleTimeString()} · ${Math.max(Math.round((pipelineRun.completedAt - (pipelineRun.startedAt || pipelineRun.completedAt)) / 1000), 0)}s` : ''}`
                  : 'No active run'}
              </div>
            </div>
            {pipelineRun.status === 'running' && (
              <div style={{
                marginTop: '0.55rem',
                fontSize: '0.72rem',
                color: '#93c5fd',
                letterSpacing: '0.01em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ color: '#60a5fa' }}>🧠</span>
                <span>
                  AI is calculating and validating decisions{'.'.repeat(Math.max(1, pulseTick))}
                </span>
              </div>
            )}
            {pipelineRun.status === 'complete' && (
              <div style={{
                marginTop: '0.55rem',
                fontSize: '0.72rem',
                color: '#86efac',
                letterSpacing: '0.01em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ color: '#22c55e' }}>✅</span>
                <span>
                  Pipeline completed. Fresh snapshot published{summary?.decisions?.length ? ` · ${summary.decisions.length} AI decisions available` : ''}.
                </span>
              </div>
            )}
            {pipelineEvents.length > 0 && (
              <div style={{ marginTop: '0.6rem', maxHeight: 128, overflowY: 'auto', borderTop: '1px solid #1e293b', paddingTop: '0.5rem' }}>
                {pipelineEvents.slice(-6).map((e, idx) => (
                  <div key={`${e.ts}-${idx}`} style={{
                    fontSize: '0.7rem',
                    color: e.level === 'error' ? '#ef4444' : e.level === 'ok' ? '#22c55e' : e.level === 'warn' ? '#f59e0b' : '#94a3b8',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span style={{ opacity: 0.9 }}>
                      {e.level === 'error' ? '✕' : e.level === 'ok' ? '✓' : e.level === 'warn' ? '⚠' : '•'}
                    </span>
                    <span style={{ color: '#64748b', minWidth: 64 }}>{e.ts}</span>
                    <span>{e.msg}</span>
                  </div>
                ))}
              </div>
            )}
            {kpiDiffs.length > 0 && (
              <div style={{ marginTop: '0.6rem', paddingTop: '0.55rem', borderTop: '1px solid #1e293b', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {kpiDiffs.map((d) => (
                  <div key={d.label} style={{ background: '#052e16', border: '1px solid #166534', borderRadius: 8, padding: '0.35rem 0.55rem', fontSize: '0.68rem', color: '#86efac' }}>
                    {d.label}: {d.before.toFixed(2)} → {d.after.toFixed(2)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state — no published snapshot yet */}
        {!loading && !hasData && !summary && cacheStatus?.hasEverRefreshed && (
          <EmptyState onRefresh={() => window.location.reload()} loading={false} />
        )}

        {/* Dashboard tabs */}
        {!loading && hasData && summary && (
          <>
            {showExplainabilityPanel && (
              <div style={{ marginBottom: '1rem' }}>
                <KPIExplanationPanel records={kpiExplain} kpis={summary?.kpis || null} snapshotDate={summary?.snapshotDate || null} coverage={explainabilityCoverage} />
              </div>
            )}
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
                    const ageMins = ageMs != null ? Math.floor(ageMs / 60_000) : null;
                    const fresh = ageHrs != null && ageHrs < 24;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: fresh ? '#22c55e' : '#f59e0b', boxShadow: fresh ? '0 0 5px #22c55e80' : 'none' }} />
                        <span style={{ fontSize: '0.68rem', color: fresh ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                          {ageHrs == null
                            ? 'Unknown age'
                            : ageHrs < 1
                              ? `${Math.max(ageMins ?? 0, 0)}m ago`
                              : ageHrs < 24
                                ? `${ageHrs}h ago`
                                : `${Math.floor(ageHrs / 24)}d ago`}
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
              <ExecutiveOverview summary={summary} hasAgentDecisions={hasAgentDecisions} explainabilityEnabled={showExplainabilityPanel} />
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
          onStatusChange={(status, progress) => {
            if (status === 'running' || status === 'partial') {
              setPipelineRun((prev) => ({ ...prev, stage: 'ai_decisions', status: 'running' }));
              if (progress?.batch && progress?.totalBatches) {
                setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: `AI batch ${progress.batch}/${progress.totalBatches} · ${progress.decisionsWritten ?? 0} decisions written`, level: 'info' }]);
              }
            } else if (status === 'complete') {
              setPipelineRun((prev) => ({ ...prev, stage: 'governance_sync', status: 'running' }));
              setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: 'AI decisions completed; syncing governance and publishing dashboard…', level: 'ok' }]);
            } else if (status === 'failed') {
              setPipelineRun((prev) => ({ ...prev, stage: 'failed', status: 'failed', completedAt: Date.now() }));
              setPipelineEvents((prev) => [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg: 'AI decision stage failed', level: 'error' }]);
            }
          }}
          onComplete={() => {
            finalizePipelineSuccess();
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
