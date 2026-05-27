import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: LLM settings hardening', () => {
  test('anthropic provider requires explicit valid key and model; local remains fail-safe default', async () => {
    const token = await loginAndGetToken();

    // Missing key -> reject
    const missingKey = await authPost('/api/settings/llm', token, {
      llmProvider: 'anthropic',
      anthropicApiKey: '',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    });
    expect(missingKey.status).not.toBe(200);

    // Invalid key format -> reject
    const invalidKey = await authPost('/api/settings/llm', token, {
      llmProvider: 'anthropic',
      anthropicApiKey: 'not-a-valid-key',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    });
    expect(invalidKey.status).not.toBe(200);

    // Valid cloud config -> accept
    const validCloud = await authPost('/api/settings/llm', token, {
      llmProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-test-valid-key',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    });
    expect(validCloud.status).toBe(200);

    // Reload reflects explicit cloud opt-in
    const afterCloud = await authGet('/api/settings/llm', token);
    expect(afterCloud.status).toBe(200);
    const afterCloudBody = await afterCloud.json() as any;
    expect(afterCloudBody?.data?.llmProvider).toBe('anthropic');

    // Switch back to local and ensure no silent cloud fallback
    const local = await authPost('/api/settings/llm', token, {
      llmProvider: 'local',
      anthropicApiKey: null,
      anthropicModel: null,
    });
    expect(local.status).toBe(200);

    const afterLocal = await authGet('/api/settings/llm', token);
    expect(afterLocal.status).toBe(200);
    const afterLocalBody = await afterLocal.json() as any;
    expect(afterLocalBody?.data?.llmProvider).toBe('local');
  });
});
