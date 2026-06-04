/**
 * FINAL DEMO GATE — 8-point smoke test
 * All 8 must pass before demo.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots/demo-gate');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';
const VALID_CLASSIFICATIONS = ['REAL', 'EMPTY', 'UNIMPLEMENTED', 'BASELINE'];

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
}

// ─── Gate 1: Login ────────────────────────────────────────────────────────────
test('Gate 1 — Login succeeds', async ({ page }) => {
  await login(page);
  const url = page.url();
  console.log('Post-login URL:', url);
  await page.screenshot({ path: `${screenshotsDir}/gate1-login.png` });
  expect(url).not.toContain('/login');
});

// ─── Gate 2: Executive tab loads ──────────────────────────────────────────────
test('Gate 2 — Executive tab loads', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  await page.locator('text=EXECUTIVE OVERVIEW').first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/gate2-executive-tab.png` });

  const text = await page.evaluate(() => document.body.innerText);
  expect(text).toMatch(/EXECUTIVE OVERVIEW|ROI|GainScope|Spend/i);
});

// ─── Gate 3: ROI / GainScope / Spend values visible ──────────────────────────
test('Gate 3 — ROI / GainScope / Spend values visible', async ({ page }) => {
  const token = await (async () => {
    const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'admin@bitso.com', password: 'Admin@12345' },
    });
    const j = await res.json();
    return j.data?.accessToken || j.accessToken || '';
  })();

  const res = await page.request.get(`${BASE_URL}/api/executive-summary`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
      'X-User-ID':   'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
      'X-User-Role': 'admin',
    },
  });
  expect(res.ok()).toBeTruthy();
  const kpis = (await res.json()).data?.kpis;

  // All 10 Tier-A must have valid non-null classifications from real logic
  const tierA = [
    'roiScore', 'gainScopeScore', 'storageSavingsPotential',
    'totalLicenseSpend', 'licenseSpendLowValue',
    'tier1SpendAnnual', 'tier2SpendAnnual', 'tier3SpendAnnual', 'tier4SpendAnnual',
    'avgConfidence',
  ];

  const failures: string[] = [];
  for (const m of tierA) {
    const cls = kpis?.[`${m}Classification`];
    if (!VALID_CLASSIFICATIONS.includes(cls)) {
      failures.push(`${m}: classification="${cls}" INVALID`);
    } else {
      console.log(`  ✅ ${m}: ${kpis[m]} [${cls}]`);
    }
  }
  expect(failures, failures.join('\n')).toHaveLength(0);

  // No testMode forced overrides — classifications must come from real extractKPI logic
  // If testMode were active, gainScopeScore would be EMPTY and storageSavingsPotential UNIMPLEMENTED
  // With real data both return REAL
  expect(kpis.gainScopeScoreClassification).not.toBe('EMPTY');         // was forced EMPTY in testMode
  expect(kpis.storageSavingsPotentialClassification).not.toBe('UNIMPLEMENTED'); // was forced UNIMPLEMENTED
  console.log('\n  ✅ No test overrides active — classifications are from real backend logic');
});

// ─── Gate 4: Detail tab shows real scoring rows ───────────────────────────────
test('Gate 4 — Detail tab shows real scoring rows', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE_URL}/detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${screenshotsDir}/gate4-detail.png` });

  // Real indexes present
  expect(text).toContain('history');
  expect(text).toContain('Low-Value');
  // Confidence is correct (not 10000%)
  expect(text).not.toContain('10000%');
  // No broken table values
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('NaN');
  console.log('  ✅ Detail tab: real rows present, 10000% gone, no undefined/NaN');
});

// ─── Gate 5: Settings → AI visible ───────────────────────────────────────────
test('Gate 5 — Settings → AI tab visible and functional', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  const aiTab = page.locator('text=AI / Governance').first();
  await expect(aiTab).toBeVisible();
  await aiTab.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/gate5-settings-ai.png` });

  const text = await page.evaluate(() => document.body.innerText);
  expect(text).toMatch(/Cloud LLM|Ollama|AI provider|Explainability/i);
  console.log('  ✅ Settings → AI/Governance tab visible and shows LLM config');
});

// ─── Gate 6: No console errors ────────────────────────────────────────────────
test('Gate 6 — No console errors on executive dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`));

  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const critical = errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('404') &&
    !e.includes('net::ERR') &&
    !e.includes('hydration')   // suppressHydrationWarning handles these
  );

  if (critical.length > 0) console.log('CRITICAL ERRORS:', critical);
  await page.screenshot({ path: `${screenshotsDir}/gate6-console-clean.png` });
  expect(critical, `Console errors: ${critical.join('; ')}`).toHaveLength(0);
  console.log('  ✅ Zero critical console errors');
});

// ─── Gate 7: No AI Debug panel ───────────────────────────────────────────────
test('Gate 7 — AI debug panel NOT visible to executives', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${screenshotsDir}/gate7-no-debug-panel.png` });

  expect(text).not.toContain('AI Debug:');
  expect(text).not.toContain('always visible for local debugging');
  expect(text).not.toContain('Capture AI Logs');
  expect(text).not.toContain('AI Run Inspector');
  console.log('  ✅ AI Debug panel is hidden from executive view');
});

// ─── Gate 8: No raw FAILED_MODEL_UNAVAILABLE visible ─────────────────────────
test('Gate 8 — No raw failure codes visible to executives', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${screenshotsDir}/gate8-no-raw-errors.png` });

  const forbidden = [
    'FAILED_MODEL_UNAVAILABLE',
    'OLLAMA_UNREACHABLE',
    'Intelligence failed',
    'LLM_FAILED',
    'PIPELINE_ERROR',
  ];
  const found = forbidden.filter(f => text.includes(f));

  if (found.length > 0) console.log('FORBIDDEN TEXT FOUND:', found);
  expect(found, `Raw failure codes visible: ${found.join(', ')}`).toHaveLength(0);
  console.log('  ✅ No raw failure codes exposed to executives');
});
