import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { updateRuntimeConfig } from '@/lib/runtime-config';

export const GET = createRoute(async () => {
  const res = await query<any>(
    `SELECT llm_provider, anthropic_api_key, anthropic_model
     FROM user_config WHERE config_key = 'default' LIMIT 1`
  );
  const rawProvider = res.rows[0]?.llm_provider;
  const rawApiKey = res.rows[0]?.anthropic_api_key;
  const rawModel = res.rows[0]?.anthropic_model;

  const hasValidAnthropicConfig =
    rawProvider === 'anthropic' &&
    typeof rawApiKey === 'string' &&
    rawApiKey.trim().startsWith('sk-ant-');

  // Fail safe: if cloud provider is configured without a valid key, force local mode.
  const config = {
    llmProvider: hasValidAnthropicConfig ? 'anthropic' : 'local',
    anthropicApiKey: typeof rawApiKey === 'string' ? rawApiKey : null,
    anthropicModel: typeof rawModel === 'string' && rawModel.trim().length > 0
      ? rawModel.trim()
      : 'claude-3-5-sonnet-20241022',
  };
  return { data: config, meta: { source: 'postgres' } };
});

export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const providerInput = typeof body?.llmProvider === 'string' ? body.llmProvider.trim() : '';
  const apiKeyInput = typeof body?.anthropicApiKey === 'string' ? body.anthropicApiKey.trim() : '';
  const modelInput = typeof body?.anthropicModel === 'string' ? body.anthropicModel.trim() : '';
  const llmProvider: 'local' | 'anthropic' = providerInput === 'anthropic' ? 'anthropic' : 'local';

  if (providerInput && !['local', 'anthropic'].includes(providerInput)) {
    throw new Error('llmProvider must be "local" or "anthropic"');
  }
  if (llmProvider === 'anthropic' && !apiKeyInput) {
    throw new Error('Anthropic API key is required when using Cloud provider');
  }
  if (llmProvider === 'anthropic' && !apiKeyInput.startsWith('sk-ant-')) {
    throw new Error('Anthropic API key format is invalid');
  }
  if (llmProvider === 'anthropic' && !modelInput) {
    throw new Error('Anthropic model is required when using Cloud provider');
  }

  const persistedApiKey = llmProvider === 'anthropic' ? apiKeyInput : null;
  const persistedModel = llmProvider === 'anthropic'
    ? modelInput
    : 'claude-3-5-sonnet-20241022';

  await query(
    `UPDATE user_config
     SET llm_provider = COALESCE($1, llm_provider),
         anthropic_api_key = $2,
         anthropic_model = COALESCE($3, anthropic_model),
         updated_at = NOW()
     WHERE config_key = 'default'`,
    [llmProvider, persistedApiKey, persistedModel]
  );

  updateRuntimeConfig({ llmProvider, anthropicApiKey: persistedApiKey, anthropicModel: persistedModel });

  return { data: { ok: true }, meta: { source: 'postgres' } };
});
