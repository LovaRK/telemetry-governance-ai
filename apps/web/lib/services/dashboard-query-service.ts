'use client';

import { apiFetch } from '@/lib/api-client';
import type { CacheStatus, ExecutiveSummary, KPIExplainabilityRecord } from '@/lib/types';

export interface DashboardState {
  cacheStatus: CacheStatus | null;
  executiveSummary: ExecutiveSummary | null;
  splunkConfig: any | null;
  pendingDecisionCount: number;
  latestJob: any | null;
  explainability: {
    records: KPIExplainabilityRecord[];
    coverage: any | null;
  };
  errors: Array<{ endpoint: string; status?: number; message: string }>;
}

export async function getDashboardState(opts: {
  includeExplainability: boolean;
}): Promise<DashboardState> {
  const errors: DashboardState['errors'] = [];

  const fail = async (endpoint: string, res: Response) => {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error || msg;
    } catch {
      // ignore
    }
    errors.push({ endpoint, status: res.status, message: msg });
  };

  let cacheStatus: CacheStatus | null = null;
  const cacheRes = await apiFetch('/api/cache-status');
  if (!cacheRes.ok) {
    await fail('/api/cache-status', cacheRes);
    return {
      cacheStatus: null,
      executiveSummary: null,
      splunkConfig: null,
      pendingDecisionCount: 0,
      latestJob: null,
      explainability: { records: [], coverage: null },
      errors,
    };
  }

  const cachePayload = await cacheRes.json();
  cacheStatus = (cachePayload?.data || cachePayload) as CacheStatus;

  const [splunkRes, pendingRes, jobRes, summaryRes] = await Promise.all([
    apiFetch('/api/splunk/config'),
    apiFetch('/api/decision-lineage?limit=1'),
    apiFetch('/api/job-status/latest'),
    cacheStatus.hasEverRefreshed ? apiFetch('/api/executive-summary') : Promise.resolve(null),
  ]);

  let splunkConfig: any | null = null;
  if (splunkRes.ok) {
    const p = await splunkRes.json();
    splunkConfig = p?.data || p;
  } else {
    await fail('/api/splunk/config', splunkRes);
  }

  let pendingDecisionCount = 0;
  if (pendingRes.ok) {
    const p = await pendingRes.json();
    if (p?.mode === 'FULL_STACK' && Array.isArray(p?.data)) pendingDecisionCount = p.data.length;
  } else {
    await fail('/api/decision-lineage?limit=1', pendingRes);
  }

  let latestJob: any | null = null;
  if (jobRes.ok) {
    const p = await jobRes.json();
    latestJob = p?.data || null;
  } else {
    await fail('/api/job-status/latest', jobRes);
  }

  let executiveSummary: ExecutiveSummary | null = null;
  if (summaryRes) {
    if (summaryRes.ok) {
      const p = await summaryRes.json();
      const summaryData = p?.data || p;
      executiveSummary = summaryData?.empty === true ? (summaryData as ExecutiveSummary) : (summaryData as ExecutiveSummary);
    } else {
      await fail('/api/executive-summary', summaryRes);
    }
  }

  let explainRecords: KPIExplainabilityRecord[] = [];
  let explainCoverage: any | null = null;
  if (opts.includeExplainability && executiveSummary?.snapshots?.length) {
    const [explainRes, coverageRes] = await Promise.all([
      apiFetch('/api/executive-summary/explain'),
      apiFetch('/api/explainability/coverage'),
    ]);

    if (explainRes.ok) {
      const p = await explainRes.json();
      explainRecords = p?.data || [];
    } else {
      await fail('/api/executive-summary/explain', explainRes);
    }

    if (coverageRes.ok) {
      const p = await coverageRes.json();
      explainCoverage = p?.data || null;
    } else {
      await fail('/api/explainability/coverage', coverageRes);
    }
  }

  return {
    cacheStatus,
    executiveSummary,
    splunkConfig,
    pendingDecisionCount,
    latestJob,
    explainability: {
      records: explainRecords,
      coverage: explainCoverage,
    },
    errors,
  };
}
