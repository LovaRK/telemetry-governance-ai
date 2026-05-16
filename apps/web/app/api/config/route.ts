import { NextResponse } from 'next/server';
import { loadUserConfig, updateUserConfig, UserConfig } from '@api/services/config-service';

export async function GET() {
  try {
    const config = await loadUserConfig();
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load config' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const updates: Partial<Omit<UserConfig, 'id' | 'createdAt' | 'updatedAt'>> = {};
    
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
    
    if (body.decisionWeights && typeof body.decisionWeights === 'object') {
      updates.decisionWeights = body.decisionWeights;
    }
    
    if (body.retentionPolicy && typeof body.retentionPolicy === 'object') {
      updates.retentionPolicy = body.retentionPolicy;
    }
    
    const updatedConfig = await updateUserConfig(updates);
    return NextResponse.json(updatedConfig);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update config' },
      { status: 500 }
    );
  }
}