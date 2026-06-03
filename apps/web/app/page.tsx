'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { getDashboardState } from '../lib/services/dashboard-query-service';
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
import { useSmartPolling } from '../lib/use-smart-polling';

type Tab = 'overview' | 'telemetry' | 'governance';
type PipelineStage = 'idle' | 'splunk_fetch' | 'snapshot_write' | 'kpi_aggregation' | 'ai_decisions' | 'governance_sync' | 'dashboard_publish' | 'complete' | 'failed';
type PipelineStatus = 'idle' | 'running' | 'complete' | 'failed';

const PIPELINE_STATE_KEY = 'pipeline_run_state_v1';
const STALE_PIPELINE_RUN_MS = 5 * 60 * 1000;

function stageFromJobStatus(status: string): PipelineStage {
  if (status === 'failed') return 'failed';
  if (status === 'complete') return 'dashboard_publish';
  return 'ai_decisions';
}

function isStaleTimestamp(timestamp?: string | number | null): boolean {
  if (!timestamp) return false;
  const createdAt = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > STALE_PIPELINE_RUN_MS;
}

function isStaleJob(job: { createdAt?: string | number | null; startedAt?: string | number | null }): boolean {
  return isStaleTimestamp(job.startedAt || job.createdAt);
}

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
    hec_token: '',
    disable_ssl_verify: true,
  });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [splunkConfigLoaded, setSplunkConfigLoaded] = useState(false);
  const [splunkConfigured, setSplunkConfigured] = useState(false);
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
  const [aiDebug, setAiDebug] = useState<{
    capturedAt: string;
    cacheStatus: any;
    latestJob: any;
    pipelineRun: any;
    activeJobId: string | null;
  } | null>(null);
  const [aiInspectorOpen, setAiInspectorOpen] = useState(true);
  const [aiDebugNotice, setAiDebugNotice] = useState<string | null>(null);
  const [aiInspectorData, setAiInspectorData] = useState<{
    capturedAt: string;
    cacheStatus: any;
    latestJob: any;
    pipelineRun: any;
    activeJobId: string | null;
    pipelineEvents: Array<{ ts: string; msg: string; level?: 'info' | 'ok' | 'warn' | 'error' }>;
  } | null>(null);
  const [kpiExplain, setKpiExplain] = useState<KPIExplainabilityRecord[]>([]);
  const [explainabilityCoverage, setExplainabilityCoverage] = useState<{ totalKpis: number; expandableKpis: number; coveragePercent: number; missingProvenance: number; missingConfidence: number; missingFormulas: number } | null>(null);
  const { enabled: explainabilityEnabled } = useExplainability();
  const showExplainabilityPanel =
    process.env.NEXT_PUBLIC_ENABLE_EXPLAINABILITY === 'true' &&
    explainabilityEnabled;
  const lifecycleSnapshotStatus = (cacheStatus as any)?.activeState?.snapshotStatus ?? cacheStatus?.snapshotStatus;
  const lifecycleLlmStatus = (cacheStatus as any)?.activeState?.llmStatus ?? cacheStatus?.llmStatus;
  const lifecyclePipelineStatus = (cacheStatus as any)?.activeState?.pipelineStatus ?? cacheStatus?.pipelineStatus;

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
      if (summaryData && summaryResponse.meta) {
        summaryData.snapshotId = summaryResponse.meta.snapshotId;
        summaryData.runId = summaryResponse.meta.runId;
      }

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

  const loadDashboardState = async () => {
    const state = await getDashboardState({ includeExplainability: showExplainabilityPanel });
    if (state.errors.length > 0 && !state.cacheStatus) {
      const first = state.errors[0];
      setError(`Failed to load dashboard: ${first?.message || 'Unknown error'}`);
    }

    if (state.cacheStatus) setCacheStatus(state.cacheStatus);
    setPendingDecisionCount(state.pendingDecisionCount || 0);

    if (state.splunkConfig) {
      const cfg = state.splunkConfig;
      const configured = Boolean(cfg?.url);
      setSplunkConfigured(configured);
      setSplunkConfigLoaded(true);
      setFormData((prev) => ({
        ...prev,
        mcp_url: typeof cfg?.url === 'string' ? cfg.url : prev.mcp_url,
        auth_type: typeof cfg?.username === 'string' && cfg.username ? 'basic' : prev.auth_type,
        disable_ssl_verify: typeof cfg?.ssl_verify === 'boolean' ? !cfg.ssl_verify : prev.disable_ssl_verify,
      }));
    } else {
      setSplunkConfigured(false);
      setSplunkConfigLoaded(true);
    }

    if (!state.cacheStatus?.hasEverRefreshed) {
      setSummary(null);
      return;
    }

    if (state.executiveSummary?.snapshots?.length > 0 || (state.executiveSummary as any)?.empty === true) {
      setSummary(state.executiveSummary as ExecutiveSummary);
      setKpiExplain(state.explainability.records || []);
      setExplainabilityCoverage(state.explainability.coverage || null);
    } else {
      setSummary(null);
      setKpiExplain([]);
      setExplainabilityCoverage(null);
    }

    const job = state.latestJob;
    if (job?.jobId && job?.status) {
      if (job.status === 'pending' || job.status === 'running' || job.status === 'partial') {
        if (isStaleJob(job)) {
          setActiveJobId(null);
          setPipelineRun((prev) => ({
            ...prev,
            runId: job.jobId,
            startedAt: job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : prev.startedAt),
            completedAt: Date.now(),
            status: 'complete',
            stage: 'complete',
          }));
        } else {
          setActiveJobId(job.jobId);
          setPipelineRun((prev) => ({
            runId: job.jobId,
            startedAt: job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : prev.startedAt),
            completedAt: null,
            status: 'running',
            stage: stageFromJobStatus(job.status),
          }));
        }
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
    }
  };

  const fetchSplunkConfig = async () => {
    try {
      const res = await apiFetch('/api/splunk/config');
      if (!res.ok) {
        setSplunkConfigured(false);
        setSplunkConfigLoaded(true);
        return;
      }
      const payload = await res.json();
      const cfg = payload?.data || payload;
      const configured = Boolean(cfg?.url);
      setSplunkConfigured(configured);
      setSplunkConfigLoaded(true);
      setFormData((prev) => {
        const nextUrl = typeof cfg?.url === 'string' ? cfg.url : prev.mcp_url;
        const nextDisableSsl = typeof cfg?.ssl_verify === 'boolean' ? !cfg.ssl_verify : prev.disable_ssl_verify;
        const nextAuthType = typeof cfg?.username === 'string' && cfg.username ? 'basic' : prev.auth_type;
        return {
          ...prev,
          mcp_url: nextUrl,
          auth_type: nextAuthType,
          disable_ssl_verify: nextDisableSsl,
        };
      });
    } catch (e) {
      console.error('Failed to load Splunk config:', e);
      setSplunkConfigured(false);
      setSplunkConfigLoaded(true);
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
        if (isStaleJob(job)) {
          try {
            sessionStorage.removeItem(PIPELINE_STATE_KEY);
          } catch {
            // Ignore storage failures.
          }
          setActiveJobId(null);
          setPipelineRun((prev) => ({
            ...prev,
            runId: job.jobId,
            startedAt: job.startedAt ? new Date(job.startedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : prev.startedAt),
            completedAt: Date.now(),
            status: 'complete',
            stage: 'complete',
          }));
          setPipelineEvents((prev) => {
            const msg = 'Discarded stale in-progress pipeline run after reload';
            if (prev.some((p) => p.msg === msg)) return prev;
            return [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg, level: 'warn' }];
          });
          return;
        }
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
    const loadInitialState = async () => {
      await loadDashboardState();
      try {
        const raw = sessionStorage.getItem(PIPELINE_STATE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const pipelineRun = parsed?.pipelineRun;
          const activeJobId = typeof parsed?.activeJobId === 'string' ? parsed.activeJobId : null;
          const isRunning = pipelineRun?.status === 'running';
          const runStartedAt = pipelineRun?.startedAt ?? null;
          const isStale = isRunning && isStaleTimestamp(runStartedAt);
          if (!isStale && pipelineRun) setPipelineRun(pipelineRun);
          if (!isStale && Array.isArray(parsed?.pipelineEvents)) setPipelineEvents(parsed.pipelineEvents);
          if (!isStale && activeJobId) setActiveJobId(activeJobId);
          if (isStale) {
            try {
              sessionStorage.removeItem(PIPELINE_STATE_KEY);
            } catch {
              // Ignore storage failures.
            }
          }
        }
      } catch {
        // Ignore invalid persisted state
      }
      setLoading(false);
    };
    loadInitialState();
  }, []);

  useEffect(() => {
    if (loading || !cacheStatus) return;
    if (pipelineRun.status !== 'running') return;

    // Canonical lifecycle from backend decides pipeline closure.
    if (lifecyclePipelineStatus === 'READY' && lifecycleLlmStatus === 'READY') {
      setActiveJobId(null);
      setPipelineRun((prev) => ({
        ...prev,
        stage: 'complete',
        status: 'complete',
        completedAt: prev.completedAt || Date.now(),
      }));
      setPipelineEvents((prev) => {
        const msg = 'Pipeline completed successfully (snapshot + AI decisions ready)';
        if (prev.some((p) => p.msg === msg)) return prev;
        return [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg, level: 'ok' }];
      });
      return;
    }

    if (lifecyclePipelineStatus === 'FAILED') {
      setActiveJobId(null);
      setPipelineRun((prev) => ({
        ...prev,
        stage: 'failed',
        status: 'failed',
        completedAt: prev.completedAt || Date.now(),
      }));
      setPipelineEvents((prev) => {
        const msg = `Pipeline failed: ${cacheStatus.failureCode || 'RUNTIME'}${cacheStatus.failureReason ? ` (${cacheStatus.failureReason})` : ''}`;
        if (prev.some((p) => p.msg === msg)) return prev;
        return [...prev.slice(-9), { ts: new Date().toLocaleTimeString(), msg, level: 'error' }];
      });
    }
  }, [loading, lifecyclePipelineStatus, lifecycleLlmStatus, cacheStatus?.failureCode, cacheStatus?.failureReason, pipelineRun.status]);

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

  // While snapshot is ready but AI is still running, keep syncing lifecycle from backend.
  // Use smart polling: 3s while RUNNING, 60s while READY, pause when hidden
  const shouldPollDashboard = cacheStatus && lifecycleSnapshotStatus === 'READY' && lifecycleLlmStatus === 'RUNNING';
  const dashboardPollCallback = useCallback(() => loadDashboardState(), []);
  useSmartPolling(
    dashboardPollCallback,
    lifecycleLlmStatus, // Use LLM status to determine poll rate: RUNNING=3s, else=60s
    shouldPollDashboard
  );

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

  // Check if form has required fields filled for initial connection
  const hasFormValidation = formData.mcp_url && (
    formData.auth_type === 'token' ? formData.token : (formData.username && formData.password)
  );

  const canRefresh = splunkConfigLoaded && (splunkConfigured || cacheStatus?.pipelineStatus === 'READY' || hasFormValidation);

  const handleRefresh = async () => {
    if (refreshing || !canRefresh) return;
    setRefreshing(true);
    setError(null);

    try {
      // If not yet configured in database, save the form config first
      if (!splunkConfigured && hasFormValidation) {
        try {
          const configPayload: any = {
            url: formData.mcp_url,
            mcpUrl: formData.mcp_url,
            ssl_verify: !formData.disable_ssl_verify,
          };

          if (formData.auth_type === 'token') {
            configPayload.token = formData.token;
          } else {
            configPayload.username = formData.username;
            configPayload.password = formData.password;
          }

          // Include HEC token if provided (optional)
          if (formData.hec_token && formData.hec_token.trim().length > 0) {
            configPayload.hec_token = formData.hec_token;
          }

          const saveRes = await apiFetch('/api/splunk/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configPayload),
          });

          if (!saveRes.ok) {
            const errData = await saveRes.json();
            setError(`Failed to save Splunk config: ${errData.error || 'Unknown error'}`);
            setRefreshing(false);
            setPipelineRun((prev) => ({ ...prev, status: 'failed', stage: 'failed', completedAt: Date.now() }));
            return;
          }

          // Config saved successfully, reload it
          await fetchSplunkConfig();
        } catch (e) {
          setError(`Failed to save Splunk configuration: ${e instanceof Error ? e.message : 'Unknown error'}`);
          setRefreshing(false);
          setPipelineRun((prev) => ({ ...prev, status: 'failed', stage: 'failed', completedAt: Date.now() }));
          return;
        }
      }

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

      const refreshPayload: { costPerGbPerDay?: number } = {};

      // Pull latest runtime config so refresh uses current cost model from Config panel.
      const configRes = await apiFetch('/api/config');
      if (configRes.ok) {
        const configJson = await configRes.json();
        const cfg = configJson?.data || configJson;
        if (typeof cfg?.costPerGbPerDay === 'number' && Number.isFinite(cfg.costPerGbPerDay)) {
          refreshPayload.costPerGbPerDay = cfg.costPerGbPerDay;
        }
      }

      const res = await apiFetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshPayload),
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
      const refreshData = result?.data || result;
      setPipelineRun((prev) => ({ ...prev, stage: 'snapshot_write' }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `Fetched ${refreshData?.inserted ?? 0} indexes from Splunk`, level: 'ok' }]);
      setPipelineRun((prev) => ({ ...prev, stage: 'kpi_aggregation' }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: 'Aggregating KPI scores…', level: 'info' }]);
      if (refreshData?.jobId) setActiveJobId(refreshData.jobId);
      if (refreshData?.jobId) {
        setPipelineRun((prev) => ({ ...prev, stage: 'ai_decisions' }));
        setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `AI decision run started (${refreshData.jobId})`, level: 'info' }]);
      }
      await loadDashboardState();
      setShowConnectionEditor(false);
    } catch (e: any) {
      setError(e.message || 'Refresh failed');
      setPipelineRun((prev) => ({ ...prev, status: 'failed', stage: 'failed', completedAt: Date.now() }));
      setPipelineEvents((prev) => [...prev, { ts: new Date().toLocaleTimeString(), msg: `Refresh failed: ${e.message || 'Unknown error'}`, level: 'error' }]);
    } finally {
      setRefreshing(false);
    }
  };

  const captureAiDebug = async () => {
    try {
      const [cacheRes, latestJobRes] = await Promise.all([
        apiFetch('/api/cache-status'),
        apiFetch('/api/job-status/latest'),
      ]);
      const cachePayload = cacheRes.ok ? await cacheRes.json() : { error: `cache-status ${cacheRes.status}` };
      const latestJobPayload = latestJobRes.ok ? await latestJobRes.json() : { error: `job-status/latest ${latestJobRes.status}` };
      const snapshot = {
        capturedAt: new Date().toISOString(),
        cacheStatus: cachePayload?.data || cachePayload,
        latestJob: latestJobPayload?.data || latestJobPayload,
        pipelineRun,
        activeJobId,
      };
      setAiDebug(snapshot);
      console.group('[AI Decision Debug Snapshot]');
      console.log(snapshot);
      console.groupEnd();
      setAiDebugNotice(
        `Captured ${new Date(snapshot.capturedAt).toLocaleTimeString()} · ` +
        `pipeline=${snapshot.cacheStatus?.activeState?.pipelineStatus || snapshot.cacheStatus?.pipelineStatus || 'n/a'} · ` +
        `llm=${snapshot.cacheStatus?.activeState?.llmStatus || snapshot.cacheStatus?.llmStatus || 'n/a'} · ` +
        `failure=${snapshot.cacheStatus?.failureCode || 'none'} · ` +
        `run=${snapshot.cacheStatus?.pipelineRunId || snapshot.cacheStatus?.runId || 'n/a'} · ` +
        `job=${snapshot.latestJob?.jobId || activeJobId || 'n/a'}`
      );
    } catch (e: any) {
      setAiDebugNotice(`Failed to capture AI debug: ${e?.message || 'Unknown error'}`);
    }
  };

  const loadAiInspector = async () => {
    try {
      const [cacheRes, latestJobRes] = await Promise.all([
        apiFetch('/api/cache-status'),
        apiFetch('/api/job-status/latest'),
      ]);
      const cachePayload = cacheRes.ok ? await cacheRes.json() : { error: `cache-status ${cacheRes.status}` };
      const latestJobPayload = latestJobRes.ok ? await latestJobRes.json() : { error: `job-status/latest ${latestJobRes.status}` };
      setAiInspectorData({
        capturedAt: new Date().toISOString(),
        cacheStatus: cachePayload?.data || cachePayload,
        latestJob: latestJobPayload?.data || latestJobPayload,
        pipelineRun,
        activeJobId,
        pipelineEvents: [...pipelineEvents.slice(-12)],
      });
    } catch (e: any) {
      setAiInspectorData({
        capturedAt: new Date().toISOString(),
        cacheStatus: { error: e?.message || 'Failed to fetch cache-status' },
        latestJob: { error: e?.message || 'Failed to fetch job-status/latest' },
        pipelineRun,
        activeJobId,
        pipelineEvents: [...pipelineEvents.slice(-12)],
      });
    }
  };

  // AI Inspector: smart polling - 3s while RUNNING, 60s while idle, pause when hidden
  // First call immediately to populate inspector on render
  useEffect(() => {
    if (aiInspectorOpen) {
      loadAiInspector();
    }
  }, [aiInspectorOpen]);

  // Then use smart polling for subsequent updates
  const aiInspectorPollCallback = useCallback(() => loadAiInspector(), []);
  useSmartPolling(
    aiInspectorPollCallback,
    pipelineRun.status === 'running' ? 'RUNNING' : 'READY', // Convert to poll-rate status
    aiInspectorOpen
  );

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
  const hasAgentDecisions =
    ((cacheStatus as any)?.activeState?.llmStatus === 'READY') ||
    ((cacheStatus as any)?.publishedState?.hasAgentDecisions ?? cacheStatus?.hasAgentDecisions ?? false) ||
    ((summary?.decisions?.length ?? 0) > 0);
  const isStale = cacheStatus?.status === 'stale';
  const snapshotStatus = lifecycleSnapshotStatus ?? 'NOT_READY';
  const llmStatus = lifecycleLlmStatus ?? 'NOT_STARTED';
  const pipelineStatus = lifecyclePipelineStatus ?? 'PENDING';
  const llmDecisionsPending = snapshotStatus === 'READY' && llmStatus === 'RUNNING';
  const intelligenceFailed = snapshotStatus === 'READY' && (llmStatus === 'FAILED' || llmStatus === 'FAILED_TIMEOUT');
  const pipelineFailed = snapshotStatus === 'FAILED' || pipelineStatus === 'FAILED';

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
            <input type="text" placeholder="Splunk URL (managed in Settings)"
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
            <input type="password" placeholder="HEC Token (optional - for data ingestion)"
              value={formData.hec_token} onChange={(e) => setFormData(p => ({ ...p, hec_token: e.target.value }))}
              style={inputStyle} />
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
              title={!canRefresh ? 'Please enter Splunk connection details above first' : 'Connect to Splunk → Fetch data → Calculate metrics → Run LLM → Update dashboard'}
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
      <TopAppBar cacheStatus={cacheStatus} loading={refreshing} hasConfig={canRefresh} />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>

        {/* Compact connection bar */}
        <div style={{ marginBottom: '1.5rem', padding: '0.625rem 1rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          {!showConnectionEditor && splunkConfigured && cacheStatus?.hasEverRefreshed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formData.mcp_url} (server-configured)
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
              title={!canRefresh ? 'Splunk configuration is not saved in Settings yet.' : 'Refresh: Fetch latest Splunk data → Recalculate metrics → Run LLM recommendations → Update dashboard (2–10 min)'}
              style={{ padding: '0.375rem 0.875rem', background: (refreshing || !canRefresh) ? '#1e293b' : '#3b82f6', color: (refreshing || !canRefresh) ? '#64748b' : '#fff', border: 'none', borderRadius: 6, cursor: refreshing || !canRefresh ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: canRefresh ? 1 : 0.65 }}>
              {refreshing ? '⟳ Fetching…' : '↺ Refresh'}
            </button>
            <button onClick={() => setConfigPanelOpen(true)}
              style={{ padding: '0.375rem 0.625rem', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ⚙️
            </button>
            {splunkConfigured && (
              <button onClick={() => {
                setShowConnectionEditor(true);
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

        {/* Lifecycle warning banners */}
        {pipelineFailed && (
          <div style={alertStyle('#ef4444')}>
            ✕ Pipeline failed. Snapshot or intelligence generation did not complete successfully.
            {cacheStatus?.failureReason ? (
              <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#fecaca' }}>
                Reason: {cacheStatus.failureReason}
              </div>
            ) : null}
          </div>
        )}

        {intelligenceFailed && (
          <div style={alertStyle('#ef4444')}>
            ⚠ Snapshot ready · Intelligence failed. Re-run refresh to regenerate LLM decisions.
          </div>
        )}

        {llmDecisionsPending && (
          <div style={alertStyle('#f59e0b')}>
            ⚠ Snapshot publish completed. AI decisions are still processing in background and will appear automatically.
          </div>
        )}

        {cacheStatus?.hasEverRefreshed && (
          <div style={{ ...alertStyle('#334155'), borderColor: '#1e293b', background: '#0b1220' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>
                AI Debug: live backend pipeline state and logs (always visible for local debugging).
              </div>
              <button
                onClick={captureAiDebug}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: 6,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                Capture AI Logs
              </button>
            </div>
            {aiDebugNotice ? (
              <div style={{ marginTop: '0.45rem', fontSize: '0.72rem', color: '#93c5fd' }}>
                {aiDebugNotice}
              </div>
            ) : null}
            {aiDebug && (
              <details style={{ marginTop: '0.6rem' }}>
                <summary style={{ cursor: 'pointer', color: '#93c5fd', fontSize: '0.72rem' }}>
                  View latest captured status
                </summary>
                <pre
                  style={{
                    marginTop: '0.5rem',
                    maxHeight: 220,
                    overflow: 'auto',
                    padding: '0.5rem',
                    borderRadius: 8,
                    background: '#020617',
                    border: '1px solid #1e293b',
                    color: '#cbd5e1',
                    fontSize: '0.68rem',
                    lineHeight: 1.4,
                  }}
                >
                  {JSON.stringify(aiDebug, null, 2)}
                </pre>
              </details>
            )}
            {aiInspectorOpen && (
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid #1e293b', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.72rem', color: '#93c5fd', fontWeight: 700 }}>
                    AI Run Inspector (auto-refresh 5s)
                  </div>
                  <button
                    onClick={loadAiInspector}
                    style={{
                      padding: '0.25rem 0.55rem',
                      borderRadius: 6,
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                    }}
                  >
                    Refresh now
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <InspectorStat
                    label="Pipeline Status"
                    value={aiInspectorData?.cacheStatus?.activeState?.pipelineStatus || aiInspectorData?.cacheStatus?.pipelineStatus || 'n/a'}
                  />
                  <InspectorStat
                    label="LLM Status"
                    value={aiInspectorData?.cacheStatus?.activeState?.llmStatus || aiInspectorData?.cacheStatus?.llmStatus || 'n/a'}
                  />
                  <InspectorStat label="Failure Code" value={aiInspectorData?.cacheStatus?.failureCode || 'none'} />
                  <InspectorStat label="Decision Count" value={String(aiInspectorData?.cacheStatus?.decisionCount ?? 'n/a')} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <InspectorStat label="Run ID" value={aiInspectorData?.cacheStatus?.pipelineRunId || aiInspectorData?.pipelineRun?.runId || 'n/a'} />
                  <InspectorStat label="Job ID" value={aiInspectorData?.latestJob?.jobId || aiInspectorData?.activeJobId || 'n/a'} />
                  <InspectorStat label="Captured At" value={aiInspectorData?.capturedAt ? new Date(aiInspectorData.capturedAt).toLocaleTimeString() : 'n/a'} />
                </div>
                <details>
                  <summary style={{ cursor: 'pointer', color: '#cbd5e1', fontSize: '0.72rem' }}>Inspector JSON</summary>
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      maxHeight: 260,
                      overflow: 'auto',
                      padding: '0.5rem',
                      borderRadius: 8,
                      background: '#020617',
                      border: '1px solid #1e293b',
                      color: '#cbd5e1',
                      fontSize: '0.67rem',
                      lineHeight: 1.35,
                    }}
                  >
                    {JSON.stringify(aiInspectorData, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}

        {error && <div style={alertStyle('#ef4444')}>✕ {error}</div>}

        {loading && <div style={{ textAlign: 'center', padding: '4rem', color: '#475569', fontSize: '0.875rem' }}>Loading…</div>}

        {!loading && (
          <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: '0.45rem 0.7rem', alignItems: 'center', width: '100%', maxWidth: 640 }}>
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
            {(pipelineStatus === 'READY' || pipelineRun.status === 'complete') && (
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
                  {snapshotStatus === 'READY' && llmStatus === 'RUNNING'
                    ? 'Snapshot complete · Intelligence pending.'
                    : snapshotStatus === 'READY' && llmStatus === 'READY'
                    ? `Complete${summary?.decisions?.length ? ` · ${summary.decisions.length} AI decisions available` : ''}.`
                    : 'Pipeline completed. Fresh snapshot published.'}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', maxWidth: '100%' }}>
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
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1rem' }}>Pipeline Telemetry</h3>
                  <QueueHealthMetrics />
                </div>
                {/* HIDDEN: Decision Review Queue pending verification
                    Needs: workflow validation, backing table identification, trigger documentation.
                    Show: only after verification that this is production-ready.
                */}
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

function InspectorStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '0.45rem 0.55rem', borderRadius: 8, border: '1px solid #1e293b', background: '#020617' }}>
      <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: '#e2e8f0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</div>
    </div>
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
