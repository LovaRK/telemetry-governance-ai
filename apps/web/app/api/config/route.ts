import { NextRequest, NextResponse } from 'next/server';

export interface UserConfig {
  costPerGbPerDay: number;
  maxIndexesPerRun: number;
  llmTimeoutMs: number;
  decisionWeights?: Record<string, unknown>;
}

const DEFAULT_CONFIG: UserConfig = {
  costPerGbPerDay: 0.5,
  maxIndexesPerRun: 1000,
  llmTimeoutMs: 30000,
};

// In-memory storage for demo purposes (not persisted across restarts)
let config: UserConfig = { ...DEFAULT_CONFIG };

/**
 * GET /api/config
 * Returns current user configuration (in-memory, not persisted).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/config] GET failed:', message);
    return NextResponse.json(
      { error: 'Failed to load configuration', details: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/config
 * Update configuration fields.
 * Request body: { costPerGbPerDay?, maxIndexesPerRun?, llmTimeoutMs?, decisionWeights? }
 * Note: Changes are not persisted (in-memory only for demo).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Update only provided fields
    if (body.costPerGbPerDay !== undefined) {
      if (typeof body.costPerGbPerDay !== 'number' || body.costPerGbPerDay <= 0) {
        return NextResponse.json(
          { error: 'costPerGbPerDay must be a positive number' },
          { status: 400 }
        );
      }
      config.costPerGbPerDay = body.costPerGbPerDay;
    }

    if (body.maxIndexesPerRun !== undefined) {
      if (typeof body.maxIndexesPerRun !== 'number' || body.maxIndexesPerRun <= 0) {
        return NextResponse.json(
          { error: 'maxIndexesPerRun must be a positive number' },
          { status: 400 }
        );
      }
      config.maxIndexesPerRun = body.maxIndexesPerRun;
    }

    if (body.llmTimeoutMs !== undefined) {
      if (typeof body.llmTimeoutMs !== 'number' || body.llmTimeoutMs <= 0) {
        return NextResponse.json(
          { error: 'llmTimeoutMs must be a positive number' },
          { status: 400 }
        );
      }
      config.llmTimeoutMs = body.llmTimeoutMs;
    }

    if (body.decisionWeights !== undefined) {
      if (!body.decisionWeights || typeof body.decisionWeights !== 'object') {
        return NextResponse.json(
          { error: 'decisionWeights must be an object' },
          { status: 400 }
        );
      }
      config.decisionWeights = body.decisionWeights;
    }

    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/config] POST failed:', message);
    return NextResponse.json(
      { error: 'Failed to update configuration', details: message },
      { status: 400 }
    );
  }
}
