import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@core/pipeline/index';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mcp_url, token } = body;

    if (!mcp_url || !token) {
      return NextResponse.json({ error: 'Missing mcp_url or token' }, { status: 400 });
    }

    const result = await runPipeline({ mcp_url, token });

    const assets = result.value?.telemetry_assets || [];
    const recommendations = result.composition?.components || [];

    return NextResponse.json({
      connection: result.connection,
      timeline: result.timeline,
      telemetry_assets: assets,
      recommendations,
      summary: {
        totalAssets: assets.length,
        keep: assets.filter((a: any) => a.recommendation?.action === 'KEEP').length,
        optimize: assets.filter((a: any) => a.recommendation?.action === 'OPTIMIZE').length,
        archive: assets.filter((a: any) => a.recommendation?.action === 'ARCHIVE').length,
        eliminate: assets.filter((a: any) => a.recommendation?.action === 'ELIMINATE').length,
        investigate: assets.filter((a: any) => a.recommendation?.action === 'INVESTIGATE').length,
        totalPotentialSavings: assets.reduce((sum: number, a: any) => sum + (a.estimated_savings || 0), 0),
        dataFreshness: result.value?.data_freshness_seconds
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Pipeline failed' },
      { status: 500 }
    );
  }
}