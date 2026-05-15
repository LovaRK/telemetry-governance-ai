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

  constructor() {
    this.ollama = new OllamaClient();
    try {
      this.anthropic = new AnthropicClient();
    } catch {
      this.anthropic = null;
    }
  }

  async generate(prompt: string, opts?: LLMRouterOpts): Promise<{ response: string; provider: LLMProvider }> {
    // Try local Ollama first
    const ollamaHealthy = await this.ollama.isHealthy();
    if (ollamaHealthy) {
      try {
        const response = await this.ollama.generate(prompt, opts);
        return { response, provider: 'ollama' };
      } catch (e) {
        console.warn(`[LLMRouter] Ollama generation failed, attempting Anthropic fallback: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      console.warn('[LLMRouter] Ollama is not healthy, attempting Anthropic fallback');
    }

    // Fallback to Anthropic
    if (!this.anthropic) {
      throw new Error('No LLM available: Ollama is down and ANTHROPIC_API_KEY is not configured. Dashboard unavailable.');
    }

    try {
      const response = await this.anthropic.generate(prompt, opts);
      return { response, provider: 'anthropic' };
    } catch (e) {
      throw new Error(`All LLM providers failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    const ollamaOk = await this.ollama.isHealthy();
    if (ollamaOk) return true;

    if (this.anthropic) {
      return await this.anthropic.isHealthy();
    }

    return false;
  }
}
