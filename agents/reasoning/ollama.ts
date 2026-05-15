const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL = 'gemma:2b';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    num_ctx?: number;
  };
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  eval_duration?: number;
}

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string = OLLAMA_BASE) {
    this.baseUrl = baseUrl;
  }

  async generate(prompt: string, opts?: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<string> {
    const body: OllamaGenerateRequest = {
      model: MODEL,
      prompt,
      stream: false,
      ...(opts?.json ? { format: 'json' } : {}),
      options: {
        temperature: opts?.temperature ?? 0.1,
        top_p: 0.9,
        num_predict: opts?.maxTokens ?? 4096,
        num_ctx: 8192,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response?.trim() || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
