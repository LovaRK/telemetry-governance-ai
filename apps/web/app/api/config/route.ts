import { NextRequest, NextResponse } from 'next/server';

// In-memory config store for web-only build
let inMemoryConfig = {
  costPerGbPerDay: 0.5,
  maxRetentionDays: 730,
  maxParallel: 2,
  llmTimeoutMs: 30000,
  decisionWeights: {},
  retentionPolicy: {},
};

export interface UserConfig {
  costPerGbPerDay: number;
  maxRetentionDays: number;
  maxParallel: number;
  llmTimeoutMs: number;
  decisionWeights?: Record<string, unknown>;
  retentionPolicy?: Record<string, unknown>;
}

export async function GET() {
  try {
    return NextResponse.json(inMemoryConfig);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load config' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const updates: Partial<UserConfig> = {};

    if (typeof body.costPerGbPerDay === 'number') {
      if (body.costPerGbPerDay < 0.01 || body.costPerGbPerDay > 10) {
        return NextResponse.json(
          { error: 'costPerGbPerDay must be between 0.01 and 10.00' },
          { status: 400 }
        );
      }
      updates.costPerGbPerDay = body.costPerGbPerDay;
    }

    if (typeof body.maxRetentionDays === 'number') {
      if (body.maxRetentionDays < 7 || body.maxRetentionDays > 3650) {
        return NextResponse.json(
          { error: 'maxRetentionDays must be between 7 and 3650' },
          { status: 400 }
        );
      }
      updates.maxRetentionDays = body.maxRetentionDays;
    }

    if (typeof body.maxParallel === 'number') {
      if (body.maxParallel < 1 || body.maxParallel > 10) {
        return NextResponse.json(
          { error: 'maxParallel must be between 1 and 10' },
          { status: 400 }
        );
      }
      updates.maxParallel = body.maxParallel;
    }

    if (typeof body.llmTimeoutMs === 'number') {
      if (body.llmTimeoutMs < 5000 || body.llmTimeoutMs > 120000) {
        return NextResponse.json(
          { error: 'llmTimeoutMs must be between 5000 and 120000' },
          { status: 400 }
        );
      }
      updates.llmTimeoutMs = body.llmTimeoutMs;
    }

    if (body.decisionWeights && typeof body.decisionWeights === 'object') {
      updates.decisionWeights = body.decisionWeights;
    }

    if (body.retentionPolicy && typeof body.retentionPolicy === 'object') {
      updates.retentionPolicy = body.retentionPolicy;
    }

    inMemoryConfig = { ...inMemoryConfig, ...updates };
    return NextResponse.json(inMemoryConfig);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update config' },
      { status: 500 }
    );
  }
}
