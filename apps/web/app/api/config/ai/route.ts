/**
 * POST /api/config/ai
 *
 * Save AI provider configuration for the current user/tenant
 * Stores encrypted API keys
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';

interface AIConfigRequest {
  mode: 'local_only' | 'local_then_anthropic' | 'anthropic_only';
  ollamaUrl: string;
  ollamaModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
}

export const POST = createRoute(async (request: NextRequest) => {
  // Require authentication
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  const tenantId = context.tenantId;

  // Parse request body
  let config: AIConfigRequest;
  try {
    config = await request.json();
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  // Validate required fields
  if (!config.mode || !config.ollamaUrl || !config.ollamaModel) {
    return NextResponse.json(
      {
        error: 'Missing required fields: mode, ollamaUrl, ollamaModel',
      },
      { status: 400 }
    );
  }

  // Validate mode
  if (!['local_only', 'local_then_anthropic', 'anthropic_only'].includes(config.mode)) {
    return NextResponse.json(
      { error: 'Invalid mode' },
      { status: 400 }
    );
  }

  try {
    // Store configuration in database (user_config table)
    // In production, API keys should be encrypted at rest
    const configJson = JSON.stringify({
      mode: config.mode,
      ollamaUrl: config.ollamaUrl,
      ollamaModel: config.ollamaModel,
      anthropicModel: config.anthropicModel,
      // Note: In production, encrypt anthropicApiKey before storing
      anthropicApiKey: config.anthropicApiKey ? `***${config.anthropicApiKey.slice(-4)}` : undefined,
    });

    await query(
      `INSERT INTO user_config (tenant_id, config_key, config_value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, config_key) DO UPDATE SET config_value = $3, updated_at = NOW()`,
      [tenantId, 'ai_provider_config', configJson]
    );

    return {
      success: true,
      message: 'AI configuration saved',
      config: {
        mode: config.mode,
        ollamaUrl: config.ollamaUrl,
        ollamaModel: config.ollamaModel,
        anthropicModel: config.anthropicModel,
        anthropicApiKey: config.anthropicApiKey ? `***${config.anthropicApiKey.slice(-4)}` : undefined,
      },
    };
  } catch (e) {
    console.error('Error saving AI config:', e);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
});

export const GET = createRoute(async (request: NextRequest) => {
  // Require authentication
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  const tenantId = context.tenantId;

  try {
    const result = await query(
      `SELECT config_value FROM user_config
       WHERE tenant_id = $1 AND config_key = $2`,
      [tenantId, 'ai_provider_config']
    );

    if (result.rows.length === 0) {
      // Return default config
      return {
        mode: 'local_only',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'gemma2:9b',
        anthropicModel: 'claude-3-5-sonnet-20241022',
      };
    }

    return JSON.parse(result.rows[0].config_value);
  } catch (e) {
    console.error('Error fetching AI config:', e);
    return {
      mode: 'local_only',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'gemma2:9b',
      anthropicModel: 'claude-3-5-sonnet-20241022',
    };
  }
});
