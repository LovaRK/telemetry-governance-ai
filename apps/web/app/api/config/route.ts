import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getRuntimeConfig, updateRuntimeConfig, RuntimeUserConfig } from '@/lib/runtime-config';

export interface UserConfig {
  costPerGbPerDay: number;
  maxIndexesPerRun: number;
  llmTimeoutMs: number;
  decisionWeights?: Record<string, unknown>;
}

/**
 * GET /api/config
 * Returns current user configuration (in-memory, not persisted).
 */
export const GET = createRoute(async (request: NextRequest) => {
  const config: RuntimeUserConfig = getRuntimeConfig();
  return {
    data: config,
    meta: { source: 'system' },
  };
});

/**
 * POST /api/config
 * Update configuration fields.
 * Request body: { costPerGbPerDay?, maxIndexesPerRun?, llmTimeoutMs?, decisionWeights? }
 * Note: Changes are not persisted (in-memory only for demo).
 */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const patch: Partial<RuntimeUserConfig> = {};

  // Update only provided fields
  if (body.costPerGbPerDay !== undefined) {
    if (typeof body.costPerGbPerDay !== 'number' || body.costPerGbPerDay <= 0) {
      throw new Error('costPerGbPerDay must be a positive number');
    }
    patch.costPerGbPerDay = body.costPerGbPerDay;
  }

  if (body.maxIndexesPerRun !== undefined) {
    if (typeof body.maxIndexesPerRun !== 'number' || body.maxIndexesPerRun <= 0) {
      throw new Error('maxIndexesPerRun must be a positive number');
    }
    patch.maxIndexesPerRun = body.maxIndexesPerRun;
  }

  if (body.llmTimeoutMs !== undefined) {
    if (typeof body.llmTimeoutMs !== 'number' || body.llmTimeoutMs <= 0) {
      throw new Error('llmTimeoutMs must be a positive number');
    }
    patch.llmTimeoutMs = body.llmTimeoutMs;
  }

  if (body.decisionWeights !== undefined) {
    if (!body.decisionWeights || typeof body.decisionWeights !== 'object') {
      throw new Error('decisionWeights must be an object');
    }
    patch.decisionWeights = body.decisionWeights;
  }

  const config = updateRuntimeConfig(patch);

  return {
    data: config,
    meta: { source: 'system' },
  };
});
