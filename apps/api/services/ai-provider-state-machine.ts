/**
 * AI Provider State Machine
 *
 * Manages fallback logic between local (Ollama) and cloud (Anthropic) AI providers.
 * Implements explicit state machine to prevent silent fallbacks and ensure production-safe behavior.
 *
 * Philosophy:
 * - LOCAL_ONLY: Never call Anthropic (developer mode)
 * - LOCAL_THEN_ANTHROPIC: Try Ollama first; fall back to Anthropic if local fails AND key exists
 * - ANTHROPIC_ONLY: Never call Ollama (requires valid Anthropic key)
 *
 * States:
 * - READY: Provider is healthy and ready for inference
 * - RUNNING: Inference is in progress
 * - PARTIAL: Fallback occurred (data computed, LLM failed)
 * - FAILED: Critical failure, cannot recover
 */

export enum AIProviderMode {
  LOCAL_ONLY = 'local_only',
  LOCAL_THEN_ANTHROPIC = 'local_then_anthropic',
  ANTHROPIC_ONLY = 'anthropic_only',
}

export enum AIProviderState {
  READY = 'ready',
  RUNNING = 'running',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

export interface AIProviderConfig {
  mode: AIProviderMode;
  localUrl: string;
  localModel: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
}

export interface AIProviderDecision {
  state: AIProviderState;
  provider: 'ollama' | 'anthropic' | null;
  canProceed: boolean;
  reason?: string;
  fallbackReason?: string;
}

export class AIProviderStateMachine {
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  /**
   * Decide which provider to use based on mode and current state.
   * Returns the decision and whether to proceed.
   *
   * Decision table:
   * | Mode | Ollama | Anthropic Key | Result |
   * |------|--------|---------------|--------|
   * | LOCAL_ONLY | UP | N/A | Use Ollama → READY |
   * | LOCAL_ONLY | DOWN | N/A | Fail → FAILED |
   * | LOCAL_THEN_ANTHROPIC | UP | YES | Use Ollama → READY |
   * | LOCAL_THEN_ANTHROPIC | DOWN | YES | Use Anthropic → READY |
   * | LOCAL_THEN_ANTHROPIC | DOWN | NO | PARTIAL (no AI) |
   * | ANTHROPIC_ONLY | N/A | YES | Use Anthropic → READY |
   * | ANTHROPIC_ONLY | N/A | NO | Fail → FAILED |
   */
  async decideProvider(
    ollamaHealthy: boolean,
    anthropicKeyExists: boolean
  ): Promise<AIProviderDecision> {
    const { mode } = this.config;

    // LOCAL_ONLY mode
    if (mode === AIProviderMode.LOCAL_ONLY) {
      if (ollamaHealthy) {
        return {
          state: AIProviderState.READY,
          provider: 'ollama',
          canProceed: true,
        };
      }
      return {
        state: AIProviderState.FAILED,
        provider: null,
        canProceed: false,
        reason: 'Local model unavailable and fallback not configured',
        fallbackReason: 'LOCAL_MODEL_DOWN__NO_FALLBACK',
      };
    }

    // LOCAL_THEN_ANTHROPIC mode
    if (mode === AIProviderMode.LOCAL_THEN_ANTHROPIC) {
      if (ollamaHealthy) {
        return {
          state: AIProviderState.READY,
          provider: 'ollama',
          canProceed: true,
        };
      }
      if (anthropicKeyExists) {
        return {
          state: AIProviderState.READY,
          provider: 'anthropic',
          canProceed: true,
          fallbackReason: 'OLLAMA_DOWN__USING_ANTHROPIC',
        };
      }
      return {
        state: AIProviderState.PARTIAL,
        provider: null,
        canProceed: true, // Can proceed but without AI
        reason: 'Ollama is down and Anthropic fallback not configured',
        fallbackReason: 'OLLAMA_DOWN__NO_ANTHROPIC_KEY',
      };
    }

    // ANTHROPIC_ONLY mode
    if (mode === AIProviderMode.ANTHROPIC_ONLY) {
      if (!anthropicKeyExists) {
        return {
          state: AIProviderState.FAILED,
          provider: null,
          canProceed: false,
          reason: 'Anthropic mode selected but no API key configured',
          fallbackReason: 'ANTHROPIC_MODE__NO_KEY',
        };
      }
      return {
        state: AIProviderState.READY,
        provider: 'anthropic',
        canProceed: true,
      };
    }

    // Fallback (should not reach)
    return {
      state: AIProviderState.FAILED,
      provider: null,
      canProceed: false,
      reason: `Unknown mode: ${mode}`,
    };
  }

  /**
   * Get user-friendly error message for demo
   */
  getCustomerMessage(decision: AIProviderDecision): string {
    if (decision.canProceed && decision.provider) {
      return `Using ${decision.provider === 'ollama' ? 'local model' : 'Anthropic'} for recommendations.`;
    }

    if (decision.state === AIProviderState.PARTIAL) {
      return `AI Recommendations Unavailable

Data refresh completed successfully.
Recommendation generation could not run because
the configured AI provider is unavailable.

Action: Open Settings → AI`;
    }

    // FAILED state
    return `AI Pipeline Failed

Local model unavailable and fallback not configured.

Action:
1. Start Ollama, OR
2. Open Settings → AI and configure Anthropic`;
  }

  /**
   * Validate configuration
   */
  validate(): string[] {
    const errors: string[] = [];

    if (!this.config.localUrl) {
      errors.push('Local model URL not configured');
    }

    if (!this.config.localModel) {
      errors.push('Local model name not configured');
    }

    if (
      (this.config.mode === AIProviderMode.ANTHROPIC_ONLY ||
        this.config.mode === AIProviderMode.LOCAL_THEN_ANTHROPIC) &&
      !this.config.anthropicApiKey
    ) {
      if (this.config.mode === AIProviderMode.ANTHROPIC_ONLY) {
        errors.push('Anthropic-only mode selected but no API key provided');
      }
      // For LOCAL_THEN_ANTHROPIC, missing key is allowed (will use LOCAL_ONLY behavior)
    }

    return errors;
  }
}

/**
 * Create default state machine from environment variables
 */
export function createAIProviderStateMachine(): AIProviderStateMachine {
  const mode =
    (process.env.AI_PROVIDER_MODE as AIProviderMode) || AIProviderMode.LOCAL_ONLY;

  return new AIProviderStateMachine({
    mode,
    localUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    localModel: process.env.LLM_MODEL || 'gemma2:9b',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  });
}
