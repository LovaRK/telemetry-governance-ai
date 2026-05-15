import { OllamaClient } from './ollama';
import { ReasoningInput, ReasoningOutput, Insight } from './types';

const REASONING_PROMPT = `You are an Agentic Telemetry Analyst. Analyze the following telemetry context and generate insights.

Context:
{context}

IMPORTANT: Respond with ONLY a valid JSON object. Do NOT include markdown formatting, code blocks, or any text outside the JSON.

Generate 3-5 insights in this exact JSON format:
{
  "insights": [
    {
      "insight": "brief description",
      "confidence": { "score": 0.0-1.0, "factors": ["factor1", "factor2"] },
      "evidence": ["evidence1", "evidence2"],
      "source_queries": ["splunk query"],
      "supporting_metrics": ["metric1"],
      "trigger_conditions": ["condition1"]
    }
  ]
}

Return ONLY the JSON object, nothing else.`;

export async function runReasoningAgent(input: ReasoningInput, ollamaUrl?: string): Promise<ReasoningOutput> {
  const baseUrl = ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
  const client = new OllamaClient(baseUrl);

  const isHealthy = await client.isHealthy();
  if (!isHealthy) {
    throw new Error('Ollama with gemma4:e4b is not available');
  }

  const contextStr = JSON.stringify(input.context, null, 2);
  const prompt = REASONING_PROMPT.replace('{context}', contextStr);

  try {
    const response = await client.generate(prompt);
    
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);

    return {
      insights: parsed.insights || [],
      schema_version: 'v1'
    };
  } catch (error) {
    throw new Error(`Gemma4 reasoning failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}