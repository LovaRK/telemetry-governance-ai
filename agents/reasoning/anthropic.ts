const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface AnthropicMessage {
  content: Array<{ type: string; text: string }>;
}

export class AnthropicClient {
  private apiKey: string;

  constructor(apiKey: string = ANTHROPIC_API_KEY || '') {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for fallback');
    }
    this.apiKey = apiKey;
  }

  async generate(prompt: string, opts?: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<string> {
    const maxTokens = opts?.maxTokens ?? 4096;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: opts?.temperature ?? 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${error.slice(0, 200)}`);
    }

    const data = (await response.json()) as AnthropicMessage;
    const text = data.content?.[0]?.text || '';
    return text.trim();
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.apiKey) return false;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
