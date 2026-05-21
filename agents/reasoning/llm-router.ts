import { OllamaClient } from './ollama';
import { AnthropicClient } from './anthropic';

export type LLMProvider = 'ollama' | 'anthropic';

interface LLMRouterOpts {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export class LLMRouter {
  private ollama: OllamaClient;
  private anthropic: AnthropicClient | null;
  private anthropicEnabled: boolean;

  constructor() {
    this.ollama = new OllamaClient();
    // Anthropic is opt-in only when explicitly enabled in settings/env AND key is present.
    this.anthropicEnabled =
      process.env.ENABLE_ANTHROPIC_FALLBACK === 'true' &&
      Boolean(process.env.ANTHROPIC_API_KEY);

    if (this.anthropicEnabled) {
      try {
        this.anthropic = new AnthropicClient();
      } catch {
        this.anthropic = null;
      }
    } else {
      this.anthropic = null;
    }
  }

  async generate(prompt: string, opts?: LLMRouterOpts): Promise<{ response: string; provider: LLMProvider }> {
    // Try Ollama first, fallback to Anthropic if available
    const ollamaErr: string[] = [];

    try {
      const response = await this.ollama.generate(prompt, opts);
      return { response, provider: 'ollama' };
    } catch (e) {
      ollamaErr.push(e instanceof Error ? e.message : String(e));
    }

    // Fallback to Anthropic only when explicitly enabled
    if (this.anthropic) {
      try {
        const response = await this.anthropic.generate(prompt, opts);
        console.log('[LLMRouter] Ollama failed, using explicitly enabled Anthropic fallback');
        return { response, provider: 'anthropic' };
      } catch (e) {
        throw new Error(`All LLM providers failed: Ollama=[${ollamaErr.join('; ')}], Anthropic=[${e instanceof Error ? e.message : String(e)}]`);
      }
    }

    throw new Error(`Inference unavailable: local Ollama failed and Anthropic fallback is disabled. Error: ${ollamaErr.join('; ')}`);
  }

  async isHealthy(): Promise<boolean> {
    const ollamaOk = await this.ollama.isHealthy();
    if (ollamaOk) return true;

    if (this.anthropicEnabled && this.anthropic) {
      return await this.anthropic.isHealthy();
    }

    return false;
  }
}
