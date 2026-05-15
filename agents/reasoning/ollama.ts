interface OllamaRequest {
  model: string;
  prompt: string;
  stream: boolean;
}

interface OllamaResponse {
  response: string;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'gemma4:e2b') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generate(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false
        } as OllamaRequest)
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = (await response.json()) as OllamaResponse;
      return data.response;
    } catch (error) {
      console.error('Ollama request failed:', error);
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}