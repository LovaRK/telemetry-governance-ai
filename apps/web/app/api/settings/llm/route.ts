import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { updateRuntimeConfig } from '@/lib/runtime-config';

export const GET = createRoute(async () => {
  const res = await query<any>(
    `SELECT llm_provider, llm_mode, anthropic_api_key, anthropic_model
     FROM user_config WHERE config_key = 'default' LIMIT 1`
  );
  const rawProvider = res.rows[0]?.llm_provider;
  const rawMode = res.rows[0]?.llm_mode || 'local_only';
  const rawApiKey = res.rows[0]?.anthropic_api_key;
  const rawModel = res.rows[0]?.anthropic_model;

  const hasKey = typeof rawApiKey === 'string' && rawApiKey.trim().length > 10;

  // Fail safe: if cloud mode is configured without a valid key, force local_only.
  const effectiveMode = (rawMode !== 'local_only' && !hasKey) ? 'local_only' : rawMode;
  const effectiveProvider = effectiveMode === 'local_only' ? 'local' : 'anthropic';

  const config = {
    llmMode: effectiveMode,
    llmProvider: effectiveProvider,
    // Return masked key (last 4 chars) — never return the full key to the client
    anthropicApiKey: hasKey ? rawApiKey : null,
    anthropicModel: typeof rawModel === 'string' && rawModel.trim().length > 0
      ? rawModel.trim()
      : 'claude-3-5-sonnet-20241022',
  };
  return { data: config, meta: { source: 'postgres' } };
});

export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const modeInput = typeof body?.llmMode === 'string' ? body.llmMode.trim() : 'local_only';
  const providerInput = typeof body?.llmProvider === 'string' ? body.llmProvider.trim() : 'local';
  const apiKeyInput = typeof body?.anthropicApiKey === 'string' ? body.anthropicApiKey.trim() : '';
  const modelInput = typeof body?.anthropicModel === 'string' ? body.anthropicModel.trim() : '';

  const validModes = ['local_only', 'local_then_anthropic', 'anthropic_only'];
  if (!validModes.includes(modeInput)) {
    throw new Error(`llmMode must be one of: ${validModes.join(', ')}`);
  }

  const needsKey = modeInput !== 'local_only';

  // Fetch current key to preserve it if no new key is provided
  const current = await query<any>(`SELECT anthropic_api_key FROM user_config WHERE config_key = 'default' LIMIT 1`);
  const existingKey = current.rows[0]?.anthropic_api_key || '';

  // If mode requires key, either new key or existing key must be present
  const resolvedKey = apiKeyInput || existingKey;
  if (needsKey && !resolvedKey) {
    throw new Error('Anthropic API key is required for this mode. Enter your key to enable Anthropic.');
  }
  if (apiKeyInput && !apiKeyInput.startsWith('sk-')) {
    throw new Error('Anthropic API key must start with "sk-"');
  }

  const llmProvider = modeInput === 'local_only' ? 'local' : 'anthropic';
  const persistedKey = modeInput === 'local_only' ? null : (apiKeyInput || existingKey);
  const persistedModel = (modeInput !== 'local_only' && modelInput)
    ? modelInput
    : 'claude-3-5-sonnet-20241022';

  await query(
    `UPDATE user_config
     SET llm_provider = $1,
         llm_mode = $2,
         anthropic_api_key = $3,
         anthropic_model = $4,
         updated_at = NOW()
     WHERE config_key = 'default'`,
    [llmProvider, modeInput, persistedKey, persistedModel]
  );

  updateRuntimeConfig({ llmProvider, anthropicApiKey: persistedKey, anthropicModel: persistedModel });

  return { data: { ok: true, mode: modeInput, provider: llmProvider }, meta: { source: 'postgres' } };
});
