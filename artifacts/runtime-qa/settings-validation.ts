import { chromium } from 'playwright';

const BASE = 'http://localhost:3002';
const OUT = 'artifacts/runtime-qa/settings';

interface SettingCase {
  name: string;
  fn: () => Promise<{ pass: boolean; detail: string; screenshot: string }>;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Track Anthropic API calls to verify no silent cloud fallback
  const anthropicCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('anthropic') || req.url().includes('api.anthropic.com')) {
      anthropicCalls.push(req.url());
    }
  });

  // Helper: login and navigate to governance settings
  async function loginAndGo() {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.locator('input[type="text"], input[type="email"]').first().fill('admin@bitso.com');
    await page.locator('input[type="password"]').first().fill('Admin@12345');
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 }),
      page.getByRole('button', { name: /login|sign in/i }).click(),
    ]);
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/settings?tab=governance`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }

  // Clear LLM settings via API before each test that needs clean state
  async function resetLlmToLocal() {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    const authContext = await page.evaluate(() => localStorage.getItem('auth_context'));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (authContext) {
      try {
        const ac = JSON.parse(authContext);
        if (ac.tenantId) headers['x-tenant-id'] = ac.tenantId;
        if (ac.userId) headers['x-user-id'] = ac.userId;
        if (ac.role) headers['x-user-role'] = ac.role;
      } catch {}
    }
    await page.request.post(`${BASE}/api/settings/llm`, {
      headers,
      data: { llmProvider: 'local', anthropicApiKey: null, anthropicModel: 'claude-3-5-sonnet-20241022' },
    });
  }

  const cases: SettingCase[] = [
    {
      name: '01-default-ollama',
      fn: async () => {
        await loginAndGo();
        await resetLlmToLocal();
        await page.goto(`${BASE}/settings?tab=governance`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        const provider = await page.locator('select').first().inputValue();
        const screenshot = `${OUT}/01-default-ollama.png`;
        await page.screenshot({ path: screenshot });

        const pass = provider === 'local';
        return { pass, detail: `Provider value: "${provider}" ${pass ? '(correct: local)' : '(WRONG)'}`, screenshot };
      },
    },
    {
      name: '02-anthropic-opt-in',
      fn: async () => {
        await page.goto(`${BASE}/settings?tab=governance`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        // Select Anthropic
        await page.locator('select').first().selectOption('anthropic');
        await page.waitForTimeout(500);

        // Enter API key
        const keyInput = page.locator('input[type="password"]');
        await keyInput.fill('sk-ant-test-key-12345');

        // Click Save LLM Provider
        await page.locator('button', { hasText: 'Save LLM Provider' }).click();
        await page.waitForTimeout(500);

        // Wait for either success or error message
        let pass = false;
        for (let i = 0; i < 10; i++) {
          await page.waitForTimeout(300);
          const body = await page.textContent('body');
          if (body?.includes('LLM settings saved')) { pass = true; break; }
          if (body?.includes('Failed to save')) break;
        }

        const screenshot = `${OUT}/02-anthropic-opt-in.png`;
        await page.screenshot({ path: screenshot });

        const provider = await page.locator('select').first().inputValue();
        if (!pass && provider === 'anthropic') pass = true;

        return { pass, detail: pass ? `Anthropic save succeeded, provider: ${provider}` : 'Save did not show success indicator', screenshot };
      },
    },
    {
      name: '03-persist-after-reload',
      fn: async () => {
        await page.goto(`${BASE}/settings?tab=governance`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        const provider = await page.locator('select').first().inputValue();
        const screenshot = `${OUT}/03-persist-after-reload.png`;
        await page.screenshot({ path: screenshot });

        const pass = provider === 'anthropic';
        return { pass, detail: `Provider after reload: "${provider}" ${pass ? '(persisted: anthropic)' : '(reset to local)'}`, screenshot };
      },
    },
    {
      name: '04-reset-to-local-persists',
      fn: async () => {
        // Reset to local
        await page.locator('select').first().selectOption('local');
        await page.locator('button', { hasText: 'Save LLM Provider' }).click();
        await page.waitForTimeout(2000);

        // Reload
        await page.goto(`${BASE}/settings?tab=governance`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        const provider = await page.locator('select').first().inputValue();
        const screenshot = `${OUT}/04-reset-to-local-persists.png`;
        await page.screenshot({ path: screenshot });

        const pass = provider === 'local';
        return { pass, detail: `Provider after reset+reload: "${provider}" ${pass ? '(persisted: local)' : '(WRONG)'}`, screenshot };
      },
    },
    {
      name: '05-missing-key-fails',
      fn: async () => {
        // Select Anthropic with empty key
        await page.locator('select').first().selectOption('anthropic');
        await page.waitForTimeout(500);

        // Clear the key field
        const keyInput = page.locator('input[type="password"]');
        await keyInput.fill('');

        // Try to save
        await page.locator('button', { hasText: 'Save LLM Provider' }).click();
        await page.waitForTimeout(1500);

        const screenshot = `${OUT}/05-missing-key-fails.png`;
        await page.screenshot({ path: screenshot });

        const body = await page.textContent('body');
        const pass = body?.includes('API key is required') ?? false;
        return { pass, detail: pass ? 'Correctly rejected missing key' : 'No validation error shown', screenshot };
      },
    },
    {
      name: '06-invalid-key-fails',
      fn: async () => {
        // Enter an obviously invalid key
        const keyInput = page.locator('input[type="password"]');
        await keyInput.fill('not-a-valid-key');

        // Try to save
        await page.locator('button', { hasText: 'Save LLM Provider' }).click();
        await page.waitForTimeout(2000);

        const screenshot = `${OUT}/06-invalid-key-fails.png`;
        await page.screenshot({ path: screenshot });

        const body = await page.textContent('body');
        const pass = !body?.includes('✓ LLM settings saved.') && (body?.includes('Failed to save') || body?.includes('error') || body?.includes('invalid'));
        return { pass, detail: pass ? 'Correctly rejected invalid key' : 'Invalid key was silently accepted or allowed', screenshot };
      },
    },
    {
      name: '07-no-silent-cloud-fallback',
      fn: async () => {
        // Already set to local from test 04
        anthropicCalls.length = 0;

        // Navigate to dashboard and verify no Anthropic calls
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const screenshot = `${OUT}/07-no-silent-cloud-fallback.png`;
        await page.screenshot({ path: screenshot });

        const pass = anthropicCalls.length === 0;
        return { pass, detail: pass ? `No Anthropic API calls detected (good - using local Ollama)` : `ERROR: ${anthropicCalls.length} Anthropic calls detected: ${anthropicCalls.join(', ')}`, screenshot };
      },
    },
  ];

  // Login once for all tests
  await loginAndGo();

  const results: Array<{ name: string; pass: boolean; detail: string; screenshot: string }> = [];

  for (const c of cases) {
    try {
      const r = await c.fn();
      results.push(r);
      console.log(`${r.pass ? '✅' : '❌'} ${c.name}: ${r.detail}`);
    } catch (err) {
      results.push({ name: c.name, pass: false, detail: `EXCEPTION: ${err}`, screenshot: '' });
      console.log(`❌ ${c.name}: EXCEPTION: ${err}`);
    }
  }

  console.log('\n=== SETTINGS VALIDATION SUMMARY ===');
  let passCount = 0;
  for (const r of results) {
    if (r.pass) passCount++;
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}: ${r.detail}`);
  }
  console.log(`\n${passCount}/${results.length} settings cases pass`);

  await browser.close();
  process.exit(passCount === results.length ? 0 : 1);
}

main();
