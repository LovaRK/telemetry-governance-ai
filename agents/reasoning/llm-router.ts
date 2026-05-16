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
    // Ollama only — no fallback, no switching
    try {
      const response = await this.ollama.generate(prompt, opts);
      return { response, provider: 'ollama' };
    } catch (e) {
      throw new Error(`Inference unavailable: ${e instanceof Error ? e.message : String(e)}`);
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
