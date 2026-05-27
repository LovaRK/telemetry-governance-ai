export interface RuntimeUserConfig {
  costPerGbPerDay: number;
  maxIndexesPerRun: number;
  llmTimeoutMs: number;
  llmProvider?: 'local' | 'anthropic';
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  decisionWeights?: Record<string, unknown>;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeUserConfig = {
  costPerGbPerDay: 0.5,
  maxIndexesPerRun: 1000,
  llmTimeoutMs: 30000,
};

let runtimeConfig: RuntimeUserConfig = { ...DEFAULT_RUNTIME_CONFIG };

export function getRuntimeConfig(): RuntimeUserConfig {
  return runtimeConfig;
}

export function updateRuntimeConfig(patch: Partial<RuntimeUserConfig>): RuntimeUserConfig {
  runtimeConfig = {
    ...runtimeConfig,
    ...patch,
  };
  return runtimeConfig;
}
