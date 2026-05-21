const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const LOGIN = { email: 'admin@bitso.com', password: 'Admin@12345' };

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

(async () => {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(LOGIN),
  });
  const loginBody = await loginRes.json();
  const token = loginBody?.data?.accessToken;
  const user = loginBody?.data?.user;
  if (!token) throw new Error('Login failed: no token');

  const apiCalls = [];
  const pageSnapshots = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    const req = res.request();
    let bodyText = '';
    try { bodyText = await res.text(); } catch {}
    const json = safeJsonParse(bodyText);
    apiCalls.push({
      ts: new Date().toISOString(),
      method: req.method(),
      url,
      status: res.status(),
      ok: res.ok(),
      requestPostData: req.postData() || null,
      responsePreview: json ? {
        topKeys: Object.keys(json),
        dataKeys: json.data && typeof json.data === 'object' ? Object.keys(json.data).slice(0, 20) : null,
        mode: json?.meta?.mode,
        source: json?.meta?.source,
        traceId: json?.meta?.traceId,
        dataType: Array.isArray(json?.data) ? 'array' : typeof json?.data,
        dataLength: Array.isArray(json?.data) ? json.data.length : undefined,
      } : bodyText.slice(0, 200),
      responseJson: json,
    });
  });

  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  async function captureTab(tabName, clickText) {
    if (clickText) {
      const btn = page.getByRole('button', { name: new RegExp(clickText, 'i') });
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForTimeout(3000);
      }
    }
    const snapshot = await page.evaluate((tabName) => {
      const main = document.querySelector('main');
      const text = (main?.innerText || '').replace(/\n{2,}/g, '\n').trim();
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const metricLines = lines.filter(l => /\$|%|GB|Indexes|Risk|Confidence|Savings|Score|Gaps|Live|Drift|Queue|Review/i.test(l)).slice(0, 180);
      return {
        tab: tabName,
        title: document.title,
        url: location.href,
        headers: lines.filter(l => /Executive|Telemetry|Governance|Aetheris|datasensAI|Intelligence|Workflow|Coherence|Drift|Queue|Review|Health/i.test(l)).slice(0, 80),
        metricLines,
        fullTextSample: lines.slice(0, 250),
      };
    }, tabName);
    pageSnapshots.push(snapshot);
  }

  await captureTab('overview', 'Executive Overview');
  await captureTab('telemetry', 'Telemetry Detail');
  await captureTab('governance', 'Governance');

  // Direct API pulls for deterministic comparisons
  const headers = { Authorization: `Bearer ${token}` };
  const endpoints = [
    '/api/cache-status',
    '/api/executive-summary',
    '/api/decision-lineage?limit=100',
    '/api/governance/cache-coherence?limit=50',
    '/api/governance/mutations?limit=50',
    '/api/governance/mutation-lifecycle?limit=50',
    '/api/recommendations',
    '/api/recommendations/audit?limit=50',
    '/api/model-health',
    '/api/queue-health?limit=30',
  ];

  const directApi = {};
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`, { headers });
      const t = await r.text();
      directApi[ep] = { status: r.status, ok: r.ok, body: safeJsonParse(t) || t.slice(0, 400) };
    } catch (e) {
      directApi[ep] = { status: 0, ok: false, error: String(e) };
    }
  }

  await browser.close();

  const exec = directApi['/api/executive-summary']?.body?.data || {};
  const kpis = exec?.kpis || {};
  const snapshots = Array.isArray(exec?.snapshots) ? exec.snapshots : [];
  const decisions = Array.isArray(exec?.decisions) ? exec.decisions : [];

  const zeroChecks = {
    totalDailyGb: kpis.totalDailyGb,
    totalSourcetypes: kpis.totalSourcetypes,
    roiScore: kpis.roiScore,
    totalLicenseSpend: kpis.totalLicenseSpend,
    storageSavingsPotential: kpis.storageSavingsPotential,
    avgUtilization: kpis.avgUtilization,
    avgDetection: kpis.avgDetection,
    avgQuality: kpis.avgQuality,
    avgConfidence: kpis.avgConfidence,
    snapshotCount: snapshots.length,
    decisionCount: decisions.length,
  };

  const likelyZeroReasons = [];
  if ((kpis.totalDailyGb ?? 0) === 0 && snapshots.length > 0) {
    likelyZeroReasons.push('KPI table values are zero/fallback while snapshots exist. Executive summary likely using KPI fallback defaults for ingest.');
  }
  if ((kpis.totalSourcetypes ?? 0) === 0 && snapshots.length > 0) {
    likelyZeroReasons.push('totalSourcetypes is zero despite snapshot rows, indicating KPI-source mismatch or missing upstream sourcetype aggregation.');
  }
  if ((kpis.totalLicenseSpend ?? 0) === 0 || (kpis.storageSavingsPotential ?? 0) === 0) {
    likelyZeroReasons.push('Cost/savings KPIs are zero, likely due to missing cost model enrichment or upstream Splunk fields not mapped.');
  }
  if ((kpis.avgConfidence ?? 0) === 0 && decisions.length > 0) {
    likelyZeroReasons.push('avgConfidence is zero while decisions exist, suggesting confidence normalization/parsing issue.');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    loginUser: LOGIN.email,
    pageSnapshots,
    apiCalls,
    directApi,
    zeroChecks,
    likelyZeroReasons,
  };

  fs.writeFileSync('/tmp/dashboard_audit.json', JSON.stringify(output, null, 2));

  // markdown report
  const lines = [];
  lines.push('# Dashboard API-to-UI Audit Report');
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push(`Base URL: ${BASE}`);
  lines.push('');
  lines.push('## 1) API Call Log (captured in browser)');
  const uniq = new Map();
  for (const c of apiCalls) {
    const key = `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`;
    if (!uniq.has(key)) uniq.set(key, []);
    uniq.get(key).push(c.status);
  }
  for (const [k, statuses] of uniq.entries()) {
    lines.push(`- ${k} -> statuses: ${statuses.join(', ')}`);
  }
  lines.push('');

  lines.push('## 2) Dashboard Tab Evidence (visible text/metrics)');
  for (const snap of pageSnapshots) {
    lines.push(`### Tab: ${snap.tab}`);
    lines.push(`- URL: ${snap.url}`);
    lines.push(`- Key headers detected:`);
    snap.headers.slice(0, 20).forEach(h => lines.push(`  - ${h}`));
    lines.push('- Metric lines sample:');
    snap.metricLines.slice(0, 40).forEach(m => lines.push(`  - ${m}`));
    lines.push('');
  }

  lines.push('## 3) Direct API Payload Summary (for deterministic compare)');
  for (const ep of endpoints) {
    const r = directApi[ep];
    lines.push(`### ${ep}`);
    lines.push(`- HTTP: ${r.status} (${r.ok ? 'OK' : 'FAIL'})`);
    if (r.body && typeof r.body === 'object') {
      const data = r.body.data;
      if (Array.isArray(data)) lines.push(`- data[] length: ${data.length}`);
      else if (data && typeof data === 'object') lines.push(`- data keys: ${Object.keys(data).slice(0,20).join(', ')}`);
      else lines.push(`- data type: ${typeof data}`);
      lines.push(`- meta: source=${r.body?.meta?.source || 'n/a'}, mode=${r.body?.meta?.mode || 'n/a'}`);
    } else {
      lines.push(`- body preview: ${String(r.body).slice(0, 150)}`);
    }
    lines.push('');
  }

  lines.push('## 4) Zero-Value Findings and Likely Root Causes');
  Object.entries(zeroChecks).forEach(([k,v]) => lines.push(`- ${k}: ${v}`));
  lines.push('');
  if (likelyZeroReasons.length === 0) {
    lines.push('- No suspicious zero mismatches detected from this run.');
  } else {
    likelyZeroReasons.forEach((r, i) => lines.push(`${i+1}. ${r}`));
  }
  lines.push('');

  lines.push('## 5) Actionable Bug Queue For Next Agent');
  lines.push('1. Validate executive summary KPI source: if `snapshots.length > 0`, ensure `kpis.totalSourcetypes` and `kpis.totalDailyGb` are derived from snapshot fallback when KPI table is missing/zero.');
  lines.push('2. Trace cost pipeline: investigate why `totalLicenseSpend` and `storageSavingsPotential` are zero while dashboard has snapshots.');
  lines.push('3. Cross-check confidence aggregation: verify `avgConfidence` derivation against decision rows and normalization (0..1 vs 0..100).');
  lines.push('4. Add API-vs-UI assertion tests for key cards (Daily Ingest, Indexes, License Spend, Savings Potential) to prevent silent zero regressions.');
  lines.push('5. Review failing/empty governance subpanels when endpoint `data[]` is empty; decide expected empty state vs data contract bug.');

  fs.writeFileSync('/tmp/dashboard_audit_report.md', lines.join('\n'));
  console.log('Wrote /tmp/dashboard_audit.json and /tmp/dashboard_audit_report.md');
})();
