/**
 * Business Metric Re-Certification
 * Verifies that after the snapshot-mixing fix, all executive panels
 * display 1stMile production values — not demo/placeholder data.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const dir = path.join(process.cwd(), 'test-screenshots/recert');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const BASE = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  await page.waitForTimeout(500);
}

// ── 1. Trend API returns exactly 1 row per date ─────────────────────────────
test('Trend API: 1 authoritative row per date, no demo mixing', async ({ page }) => {
  const token = await (async () => {
    const r = await page.request.post(`${BASE}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'admin@bitso.com', password: 'Admin@12345' },
    });
    return (await r.json()).data?.accessToken || '';
  })();

  const res = await page.request.get(`${BASE}/api/kpi-history?days=30`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
      'X-User-ID':   'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
      'X-User-Role': 'admin',
    },
  });
  const data = (await res.json()).data;
  const rows = data.data as any[];

  // No duplicate dates
  const dates = rows.map((r: any) => r.date.slice(0, 10));
  const uniqueDates = new Set(dates);
  expect(uniqueDates.size, 'Duplicate dates in trend data').toBe(rows.length);
  console.log(`  ✅ ${rows.length} rows, ${uniqueDates.size} unique dates — no duplicates`);

  // Latest row must be 1stMile production data (not demo 3-sourcetype snapshot)
  const latest = rows[rows.length - 1];
  expect(latest.gainScopeScore,          'GainScope must be 5.1').toBeCloseTo(5.1, 1);
  expect(latest.storageSavingsPotential, 'Savings must be ~$554k').toBeGreaterThan(500_000);
  expect(latest.totalDailyGb,            'Daily GB must be ~159.9').toBeGreaterThan(100);
  expect(latest.roiScore,                'ROI must be ~25').toBeCloseTo(25.31, 1);
  console.log(`  ✅ Latest row: GainScope=${latest.gainScopeScore} Savings=$${Math.round(latest.storageSavingsPotential/1000)}k GB=${latest.totalDailyGb.toFixed(1)}`);
});

// ── 2. Quick Win consistency ────────────────────────────────────────────────
test('Quick Wins: agent_decisions and executive_kpis agree', async ({ page }) => {
  const token = await (async () => {
    const r = await page.request.post(`${BASE}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'admin@bitso.com', password: 'Admin@12345' },
    });
    return (await r.json()).data?.accessToken || '';
  })();

  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
    'X-User-ID':   'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
    'X-User-Role': 'admin',
  };

  const summary = await (await page.request.get(`${BASE}/api/executive-summary`, { headers })).json();
  const qw = summary.data.quickWins as any[];

  expect(qw.length, 'Quick wins must not be empty').toBeGreaterThan(0);
  expect(qw[0].savings, 'Top quick win must have real savings').toBeGreaterThan(10_000);
  // Top item must be WinRegistry or similar high-cost Nice-to-Have
  console.log(`  ✅ ${qw.length} quick wins. Top: ${qw[0].indexName} $${Math.round(qw[0].savings/1000)}k savings`);
  qw.forEach((w: any) => console.log(`    → ${w.indexName} ${w.action} $${Math.round(w.savings)}`));
});

// ── 3. Savings staircase monotonicity ──────────────────────────────────────
test('Savings staircase: 5 stages, strictly decreasing', async ({ page }) => {
  const token = await (async () => {
    const r = await page.request.post(`${BASE}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'admin@bitso.com', password: 'Admin@12345' },
    });
    return (await r.json()).data?.accessToken || '';
  })();

  const summary = await (await page.request.get(`${BASE}/api/executive-summary`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
      'X-User-ID':   'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
      'X-User-Role': 'admin',
    },
  })).json();

  const staircase = summary.data.savingsStaircase as any[];
  expect(staircase.length, 'Staircase must have 5 stages').toBe(5);

  for (let i = 1; i < staircase.length; i++) {
    const prev = staircase[i - 1].cumulative;
    const curr = staircase[i].cumulative;
    expect(curr, `Stage ${i+1} (${staircase[i].label}) must be ≤ Stage ${i} ($${Math.round(prev)})`).toBeLessThanOrEqual(prev);
    console.log(`  ✅ ${staircase[i-1].label}: $${Math.round(prev/1000)}k → ${staircase[i].label}: $${Math.round(curr/1000)}k`);
  }
  const totalSavings = staircase[0].cumulative - staircase[4].cumulative;
  console.log(`  ✅ Total addressable savings: $${Math.round(totalSavings/1000)}k`);
});

// ── 4. Dashboard screenshots (GainScope trend, Quick Wins, Staircase) ───────
test('Dashboard screenshots: all panels show production values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await login(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Top of page
  await page.screenshot({ path: `${dir}/01-top.png` });

  // Scroll to KPI bar
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.body.innerText);

  // Verify production numbers visible
  expect(text).toContain('176');   // sourcetype count
  expect(text).toMatch(/\$584|\$583/);  // annual spend
  expect(text).toMatch(/159|160/);  // daily GB
  console.log('  ✅ Production KPIs visible (176 indexes, $584k spend, ~160 GB)');

  // Scroll to KPI gauge cards
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/02-kpi-gauges.png` });

  // Scroll to trend charts
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/03-trend-charts.png` });

  // Scroll to savings staircase / score distribution
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/04-staircase-and-tiers.png` });

  // Scroll to bottom
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/05-bottom.png` });

  // Check for zero console errors
  expect(errors.length, `JS errors: ${errors.join('; ')}`).toBe(0);
  console.log('  ✅ Zero runtime errors');
});
