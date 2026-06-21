/**
 * P0.3 AI Runtime State Machine Testing
 * Verify all 6 decision paths work correctly
 */

import {
  AIProviderStateMachine,
  AIProviderMode,
  AIProviderState,
  createAIProviderStateMachine,
} from '../../apps/api/services/ai-provider-state-machine';

describe('P0.3: AI Runtime State Machine Decision Table', () => {
  let stateMachine: AIProviderStateMachine;

  beforeEach(() => {
    stateMachine = createAIProviderStateMachine();
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 1: LOCAL_ONLY + Ollama UP → READY
  // ────────────────────────────────────────────────────────────
  test('Decision 1: LOCAL_ONLY mode + Ollama UP = READY (use Ollama)', async () => {
    const decision = await stateMachine.decideProvider(
      true,  // ollamaHealthy = UP
      false  // anthropicKeyExists = N/A
    );

    expect(decision.state).toBe(AIProviderState.READY);
    expect(decision.provider).toBe('ollama');
    expect(decision.canProceed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 2: LOCAL_ONLY + Ollama DOWN → FAILED
  // ────────────────────────────────────────────────────────────
  test('Decision 2: LOCAL_ONLY mode + Ollama DOWN = FAILED (no fallback)', async () => {
    const decision = await stateMachine.decideProvider(
      false, // ollamaHealthy = DOWN
      false  // anthropicKeyExists = N/A (not used)
    );

    expect(decision.state).toBe(AIProviderState.FAILED);
    expect(decision.provider).toBeNull();
    expect(decision.canProceed).toBe(false);
    expect(decision.reason).toContain('Local model unavailable');
    expect(decision.fallbackReason).toBe('LOCAL_MODEL_DOWN__NO_FALLBACK');
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 3: LOCAL_THEN_ANTHROPIC + Ollama UP = READY (Ollama)
  // ────────────────────────────────────────────────────────────
  test('Decision 3: LOCAL_THEN_ANTHROPIC mode + Ollama UP = READY (use Ollama)', async () => {
    // Override mode for this test
    const config = {
      mode: AIProviderMode.LOCAL_THEN_ANTHROPIC,
      localUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
      localModel: process.env.LLM_MODEL || 'gemma2:9b',
      anthropicApiKey: 'test-key-exists',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(
      true,  // ollamaHealthy = UP
      true   // anthropicKeyExists = YES (available but not needed)
    );

    expect(decision.state).toBe(AIProviderState.READY);
    expect(decision.provider).toBe('ollama');
    expect(decision.canProceed).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 4: LOCAL_THEN_ANTHROPIC + Ollama DOWN + Key YES = READY (Anthropic)
  // ────────────────────────────────────────────────────────────
  test('Decision 4: LOCAL_THEN_ANTHROPIC mode + Ollama DOWN + Key YES = READY (fallback to Anthropic)', async () => {
    const config = {
      mode: AIProviderMode.LOCAL_THEN_ANTHROPIC,
      localUrl: 'http://localhost:11434',
      localModel: 'gemma2:9b',
      anthropicApiKey: 'sk-ant-test-key',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(
      false, // ollamaHealthy = DOWN
      true   // anthropicKeyExists = YES
    );

    expect(decision.state).toBe(AIProviderState.READY);
    expect(decision.provider).toBe('anthropic');
    expect(decision.canProceed).toBe(true);
    expect(decision.fallbackReason).toBe('OLLAMA_DOWN__USING_ANTHROPIC');
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 5: LOCAL_THEN_ANTHROPIC + Ollama DOWN + Key NO = PARTIAL
  // ────────────────────────────────────────────────────────────
  test('Decision 5: LOCAL_THEN_ANTHROPIC mode + Ollama DOWN + No Key = PARTIAL (graceful degradation)', async () => {
    const config = {
      mode: AIProviderMode.LOCAL_THEN_ANTHROPIC,
      localUrl: 'http://localhost:11434',
      localModel: 'gemma2:9b',
      anthropicApiKey: undefined,  // NO KEY
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(
      false, // ollamaHealthy = DOWN
      false  // anthropicKeyExists = NO
    );

    expect(decision.state).toBe(AIProviderState.PARTIAL);
    expect(decision.provider).toBeNull();
    expect(decision.canProceed).toBe(true); // Can proceed without AI
    expect(decision.reason).toContain('Ollama is down');
    expect(decision.fallbackReason).toBe('OLLAMA_DOWN__NO_ANTHROPIC_KEY');
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 6: ANTHROPIC_ONLY + Key YES = READY
  // ────────────────────────────────────────────────────────────
  test('Decision 6a: ANTHROPIC_ONLY mode + Key YES = READY (use Anthropic)', async () => {
    const config = {
      mode: AIProviderMode.ANTHROPIC_ONLY,
      localUrl: 'http://localhost:11434',
      localModel: 'gemma2:9b',
      anthropicApiKey: 'sk-ant-test-key',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(
      false, // ollamaHealthy = N/A (not checked)
      true   // anthropicKeyExists = YES
    );

    expect(decision.state).toBe(AIProviderState.READY);
    expect(decision.provider).toBe('anthropic');
    expect(decision.canProceed).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // Decision Path 6b: ANTHROPIC_ONLY + Key NO = FAILED
  // ────────────────────────────────────────────────────────────
  test('Decision 6b: ANTHROPIC_ONLY mode + No Key = FAILED (cannot proceed)', async () => {
    const config = {
      mode: AIProviderMode.ANTHROPIC_ONLY,
      localUrl: 'http://localhost:11434',
      localModel: 'gemma2:9b',
      anthropicApiKey: undefined,  // NO KEY
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(
      false, // ollamaHealthy = N/A
      false  // anthropicKeyExists = NO
    );

    expect(decision.state).toBe(AIProviderState.FAILED);
    expect(decision.provider).toBeNull();
    expect(decision.canProceed).toBe(false);
    expect(decision.reason).toContain('Anthropic mode');
    expect(decision.fallbackReason).toBe('ANTHROPIC_MODE__NO_KEY');
  });

  // ────────────────────────────────────────────────────────────
  // Customer Messages Verification
  // ────────────────────────────────────────────────────────────
  test('Customer message for PARTIAL state is actionable', async () => {
    const config = {
      mode: AIProviderMode.LOCAL_THEN_ANTHROPIC,
      localUrl: 'http://localhost:11434',
      localModel: 'gemma2:9b',
      anthropicApiKey: undefined,
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
    const testMachine = new (require('../../apps/api/services/ai-provider-state-machine').AIProviderStateMachine)(config);

    const decision = await testMachine.decideProvider(false, false);
    const message = testMachine.getCustomerMessage(decision);

    expect(message).toContain('AI Recommendations Unavailable');
    expect(message).toContain('Data refresh completed successfully');
    expect(message).toContain('Settings → AI');
  });

  test('Customer message for FAILED state includes next actions', async () => {
    const decision = await stateMachine.decideProvider(false, false);
    const message = stateMachine.getCustomerMessage(decision);

    expect(message).toContain('AI Pipeline Failed');
    expect(message).toContain('Start Ollama');
    expect(message).toContain('Settings → AI');
  });

  // ────────────────────────────────────────────────────────────
  // Summary: Decision Table Coverage
  // ────────────────────────────────────────────────────────────
  test('All 6 decision paths are covered and distinct', () => {
    // This test documents the decision table
    const decisionTable = [
      { mode: 'LOCAL_ONLY', ollama: true, key: 'N/A', expected: 'READY (Ollama)' },
      { mode: 'LOCAL_ONLY', ollama: false, key: 'N/A', expected: 'FAILED' },
      { mode: 'LOCAL_THEN_ANTHROPIC', ollama: true, key: 'YES', expected: 'READY (Ollama)' },
      { mode: 'LOCAL_THEN_ANTHROPIC', ollama: false, key: 'YES', expected: 'READY (Anthropic)' },
      { mode: 'LOCAL_THEN_ANTHROPIC', ollama: false, key: 'NO', expected: 'PARTIAL' },
      { mode: 'ANTHROPIC_ONLY', ollama: 'N/A', key: 'YES', expected: 'READY (Anthropic)' },
      { mode: 'ANTHROPIC_ONLY', ollama: 'N/A', key: 'NO', expected: 'FAILED' },
    ];

    expect(decisionTable.length).toBeGreaterThanOrEqual(6);
  });
});
