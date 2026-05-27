const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ALLOWED_MODEL = 'gemma2:9b';
const MODEL = process.env.LLM_MODEL || ALLOWED_MODEL;

if (MODEL !== ALLOWED_MODEL) {
  throw new Error(`Invalid LLM_MODEL: "${MODEL}". Only "${ALLOWED_MODEL}" is allowed for decision authority.`);
}

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

  async generate(prompt: string, opts?: { json?: boolean; temperature?: number; maxTokens?: number; signal?: AbortSignal }): Promise<string> {
    const body: OllamaGenerateRequest = {
      model: MODEL,
      prompt,
      stream: false,
      ...(opts?.json ? { format: 'json' } : {}),
      options: {
        temperature: opts?.temperature ?? 0.1,
        top_p: 0.9,
        num_predict: opts?.maxTokens ?? 1200,
        num_ctx: 4096,
      },
    };

    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.OLLAMA_REQUEST_TIMEOUT_MS || '180000', 10);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let signal = controller.signal;
    let removeExternalAbortListener: (() => void) | null = null;
    if (opts?.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        const onExternalAbort = () => controller.abort();
        opts.signal.addEventListener('abort', onExternalAbort, { once: true });
        removeExternalAbortListener = () => opts.signal?.removeEventListener('abort', onExternalAbort);
      }
      signal = controller.signal;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response?.trim() || '';
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        throw new Error(`Ollama request aborted (timeout=${timeoutMs}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (removeExternalAbortListener) removeExternalAbortListener();
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
