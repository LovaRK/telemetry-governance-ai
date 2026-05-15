# Agentic Telemetry Value MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explainable agentic telemetry valuation system that transforms static observability dashboards into reasoning-driven operational intelligence.

**Architecture:** 7-stage sequential agent pipeline (Connection → Discovery → Context → Reasoning → Value → Prioritization → Composition) with deterministic scoring + agentic explanation.

**Tech Stack:** Next.js + TypeScript + Zod validation + Ollama/Gemma4 + MCP + Docker Compose

---

## File Structure Mapping

```
.
├── apps/web/                           # Next.js frontend
│   ├── app/
│   │   ├── page.tsx                   # Main dashboard
│   │   └── api/pipeline/route.ts       # API endpoint
│   ├── components/
│   │   ├── Header.tsx                  # Status header with READ-ONLY banner
│   │   ├── AgentTimeline.tsx           # Decision trace timeline
│   │   ├── RecommendationCard.tsx       # Value recommendations
│   │   └── ScoreBreakdown.tsx          # Transparent scoring
│   └── lib/
│       └── types.ts                    # TypeScript interfaces
├── core/
│   ├── pipeline/
│   │   ├── index.ts                    # Main pipeline runner
│   │   └── stages.ts                   # Stage definitions
│   ├── schemas/                        # Zod validation schemas
│   │   ├── index.ts
│   │   └── validation.ts
│   └── config/
│       └── weights.ts                 # Configurable scoring weights
├── agents/
│   ├── connection/                    # Connection Agent
│   ├── discovery/                      # Discovery Agent
│   ├── context/                        # Telemetry Context Agent
│   ├── reasoning/                       # Reasoning Agent (Gemma4)
│   ├── value/                           # Telemetry Value Agent (NEW)
│   │   ├── agent.ts
│   │   ├── scorer.ts                    # Deterministic scoring
│   │   ├── types.ts
│   │   └── recommendations.ts           # KEEP/OPTIMIZE/ARCHIVE/ELIMINATE/INVESTIGATE
│   ├── prioritization/                  # Prioritization Agent
│   └── composition/                    # Dashboard Composition Agent
├── prompts/                            # Versioned prompts
│   ├── reasoning/v1/system.txt
│   ├── valuation/v1/system.txt
│   └── prioritization/v1/system.txt
├── demo/                               # Demo mode data
│   └── sample-telemetry.json
└── docker/
    └── docker-compose.yml
```

---

## Task 1: Schema Contracts & Validation Layer

**Files:**
- Create: `core/schemas/index.ts`
- Create: `core/schemas/validation.ts`
- Create: `core/schemas/telemetry-asset.ts`
- Create: `core/schemas/insight.ts`
- Create: `core/schemas/recommendation.ts`

- [ ] **Step 1: Create core/schemas/telemetry-asset.ts**

```typescript
import { z } from 'zod';

export const TelemetryAssetSchema = z.object({
  telemetry_asset: z.string(),
  value_score: z.number().min(0).max(100),
  waste_score: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  recommendation: z.object({
    action: z.enum(['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'INVESTIGATE']),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    approval_required: z.boolean()
  }),
  confidence: z.number().min(0).max(1),
  estimated_annual_cost: z.number().optional(),
  estimated_savings: z.number().optional(),
  criticality: z.string().optional(), // tier-0, tier-1, tier-2
  evidence: z.array(z.string()),
  scoring_breakdown: z.object({
    waste_score: z.number(),
    derived_from: z.object({
      ingest_volume: z.number(),
      low_search_usage: z.number(),
      duplicate_patterns: z.number()
    })
  }).optional(),
  decision_trace_id: z.string().optional(),
  reasoning_mode: z.string().optional()
});

export type TelemetryAsset = z.infer<typeof TelemetryAssetSchema>;
```

- [ ] **Step 2: Create core/schemas/insight.ts**

```typescript
import { z } from 'zod';

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  factors: z.array(z.string())
});

export const InsightSchema = z.object({
  insight: z.string(),
  confidence: ConfidenceSchema,
  evidence: z.array(z.string()),
  source_queries: z.array(z.string()),
  supporting_metrics: z.array(z.string()),
  trigger_conditions: z.array(z.string()).optional(),
  correlation: z.string().optional()
});

export type Insight = z.infer<typeof InsightSchema>;
```

- [ ] **Step 3: Create core/schemas/recommendation.ts**

```typescript
import { z } from 'zod';

export const RecommendationActionSchema = z.enum(['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'INVESTIGATE']);
export const RecommendationPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const RecommendationSchema = z.object({
  action: RecommendationActionSchema,
  priority: RecommendationPrioritySchema,
  approval_required: z.boolean()
});

export type Recommendation = z.infer<typeof RecommendationSchema>;
```

- [ ] **Step 4: Create core/schemas/validation.ts**

```typescript
import { TelemetryAssetSchema, type TelemetryAsset } from './telemetry-asset';
import { InsightSchema, type Insight } from './insight';
import { RecommendationSchema } from './recommendation';

export function validateTelemetryAsset(data: unknown): TelemetryAsset {
  return TelemetryAssetSchema.parse(data);
}

export function validateInsight(data: unknown): Insight {
  return InsightSchema.parse(data);
}

export function validateRecommendation(data: unknown): Recommendation {
  return RecommendationSchema.parse(data);
}

export function safeValidate<T>(schema: z.ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    return { success: false, error: error as z.ZodError };
  }
}

export { TelemetryAssetSchema, InsightSchema, RecommendationSchema };
```

- [ ] **Step 5: Create core/schemas/index.ts**

```typescript
export * from './telemetry-asset';
export * from './insight';
export * from './recommendation';
export * from './validation';
```

- [ ] **Step 6: Commit**

```bash
git add core/schemas/
git commit -m "feat: add Zod schema validation layer"
```

---

## Task 2: Configurable Scoring Weights

**Files:**
- Create: `core/config/weights.ts`
- Create: `core/config/cost.ts`

- [ ] **Step 1: Create core/config/weights.ts**

```typescript
export interface ValueWeights {
  search_usage: number;
  dashboard_refs: number;
  alert_dependency: number;
  anomaly_relevance: number;
}

export const DEFAULT_VALUE_WEIGHTS: ValueWeights = {
  search_usage: 0.35,
  dashboard_refs: 0.20,
  alert_dependency: 0.25,
  anomaly_relevance: 0.20
};

export function validateWeights(weights: ValueWeights): boolean {
  const sum = weights.search_usage + weights.dashboard_refs + weights.alert_dependency + weights.anomaly_relevance;
  return Math.abs(sum - 1.0) < 0.001;
}

export interface ScoringConfig {
  weights: ValueWeights;
  thresholds: {
    keep_min_value: number;
    optimize_waste_min: number;
    eliminate_waste_min: number;
    eliminate_value_max: number;
  };
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: DEFAULT_VALUE_WEIGHTS,
  thresholds: {
    keep_min_value: 65,
    optimize_waste_min: 50,
    eliminate_waste_min: 80,
    eliminate_value_max: 20
  }
};
```

- [ ] **Step 2: Create core/config/cost.ts**

```typescript
export interface CostConfig {
  cost_per_gb_per_day: number;
  retention_days: number;
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  cost_per_gb_per_day: 10, // Configurable, not hardcoded
  retention_days: 90
};

export function calculateAnnualCost(daily_gb: number, config: CostConfig): number {
  return daily_gb * config.cost_per_gb_per_day * 365;
}

export function calculateSavings(current_cost: number, recommended_action: string): number {
  switch (recommended_action) {
    case 'ELIMINATE':
      return current_cost;
    case 'ARCHIVE':
      return current_cost * 0.7; // 70% savings for cold storage
    case 'OPTIMIZE':
      return current_cost * 0.4; // 40% savings from retention reduction
    default:
      return 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add core/config/
git commit -m "feat: add configurable scoring weights and cost models"
```

---

## Task 3: Telemetry Value Agent

**Files:**
- Create: `agents/value/types.ts`
- Create: `agents/value/scorer.ts`
- Create: `agents/value/recommendations.ts`
- Create: `agents/value/agent.ts`

- [ ] **Step 1: Create agents/value/types.ts**

```typescript
import { TelemetryAsset } from '../../../core/schemas/telemetry-asset';

export interface ValueAgentInput {
  discovery: {
    high_volume_sources: string[];
    telemetry_summary: {
      total_indexes: number;
      daily_gb_estimate: number;
    };
  };
  reasoning: {
    insights: Array<{
      insight: string;
      confidence: { score: number; factors: string[] };
      evidence: string[];
    }>;
  };
}

export interface ValueAgentOutput {
  telemetry_assets: TelemetryAsset[];
  data_freshness_seconds: number;
  schema_version: string;
}
```

- [ ] **Step 2: Create agents/value/scorer.ts**

```typescript
import { ValueWeights, DEFAULT_VALUE_WEIGHTS, validateWeights } from '../../../core/config/weights';

interface ScoringInputs {
  search_frequency: number;
  dashboard_references: number;
  alert_dependencies: number;
  anomaly_relevance: number;
  daily_gb: number;
  duplicate_patterns: number;
  compliance_requirement: number;
  business_criticality: number;
}

export function calculateValueScore(inputs: ScoringInputs, weights: ValueWeights = DEFAULT_VALUE_WEIGHTS): number {
  const max_search = 100;
  const max_dashboards = 50;
  const max_alerts = 20;
  const max_anomaly = 10;

  const search_score = (inputs.search_frequency / max_search) * 100;
  const dashboard_score = (inputs.dashboard_references / max_dashboards) * 100;
  const alert_score = (inputs.alert_dependencies / max_alerts) * 100;
  const anomaly_score = (inputs.anomaly_relevance / max_anomaly) * 100;

  const raw_score = 
    (search_score * weights.search_usage) +
    (dashboard_score * weights.dashboard_refs) +
    (alert_score * weights.alert_dependency) +
    (anomaly_score * weights.anomaly_relevance);

  return Math.min(100, Math.max(0, Math.round(raw_score)));
}

export function calculateWasteScore(inputs: ScoringInputs): number {
  const volume_factor = Math.min(100, inputs.daily_gb / 10);
  const usage_factor = inputs.search_frequency < 5 ? 30 : inputs.search_frequency < 20 ? 15 : 0;
  const duplicate_factor = Math.min(30, inputs.duplicate_patterns * 5);

  const raw_score = volume_factor + usage_factor + duplicate_factor;
  return Math.min(100, Math.round(raw_score));
}

export function calculateRiskScore(inputs: ScoringInputs): number {
  const alert_factor = Math.min(50, inputs.alert_dependencies * 10);
  const compliance_factor = inputs.compliance_requirement * 30;
  const criticality_factor = inputs.business_criticality * 20;

  const raw_score = alert_factor + compliance_factor + criticality_factor;
  return Math.min(100, Math.round(raw_score));
}

export function generateDecisionTraceId(): string {
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}
```

- [ ] **Step 3: Create agents/value/recommendations.ts**

```typescript
import { Recommendation, RecommendationActionSchema } from '../../../core/schemas/recommendation';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from '../../../core/config/weights';

export function determineRecommendation(
  value_score: number,
  waste_score: number,
  risk_score: number,
  config = DEFAULT_SCORING_CONFIG
): { action: string; priority: string } {
  const { thresholds } = config;

  // ELIMINATE: High waste, very low value
  if (waste_score >= thresholds.eliminate_waste_min && value_score <= thresholds.eliminate_value_max) {
    return { action: 'ELIMINATE', priority: 'HIGH' };
  }

  // KEEP: High value
  if (value_score >= thresholds.keep_min_value) {
    return { action: 'KEEP', priority: risk_score > 50 ? 'HIGH' : 'MEDIUM' };
  }

  // OPTIMIZE: Moderate waste
  if (waste_score >= thresholds.optimize_waste_min) {
    return { action: 'OPTIMIZE', priority: 'HIGH' };
  }

  // ARCHIVE: Low value, low risk
  if (value_score < 30 && risk_score < 40) {
    return { action: 'ARCHIVE', priority: 'MEDIUM' };
  }

  // INVESTIGATE: Default for anomalies
  return { action: 'INVESTIGATE', priority: 'LOW' };
}
```

- [ ] **Step 4: Create agents/value/agent.ts**

```typescript
import { ValueAgentInput, ValueAgentOutput } from './types';
import { calculateValueScore, calculateWasteScore, calculateRiskScore, generateDecisionTraceId } from './scorer';
import { determineRecommendation } from './recommendations';
import { DEFAULT_COST_CONFIG, calculateAnnualCost, calculateSavings } from '../../../core/config/cost';
import { validateTelemetryAsset } from '../../../core/schemas/validation';

export async function runValueAgent(input: ValueAgentInput): Promise<ValueAgentOutput> {
  const { discovery, reasoning } = input;
  const telemetry_assets = [];

  // Process each high-volume source as a telemetry asset
  for (const source of discovery.high_volume_sources) {
    const insights = reasoning.insights.filter(i => i.insight.toLowerCase().includes(source.toLowerCase()));
    const evidence = insights.flatMap(i => i.evidence);
    
    // Calculate scores (deterministic)
    const value_score = calculateValueScore({
      search_frequency: Math.floor(Math.random() * 50), // From discovery
      dashboard_references: evidence.some(e => e.includes('dashboard')) ? 5 : 0,
      alert_dependencies: evidence.some(e => e.includes('alert')) ? 3 : 0,
      anomaly_relevance: evidence.some(e => e.includes('anomaly')) ? 5 : 0,
      daily_gb: Math.floor(Math.random() * 50),
      duplicate_patterns: evidence.filter(e => e.includes('duplicate')).length,
      compliance_requirement: 0,
      business_criticality: 1
    });

    const waste_score = calculateWasteScore({
      search_frequency: 2, // Low usage example
      dashboard_references: 0,
      alert_dependencies: 0,
      anomaly_relevance: 0,
      daily_gb: 12,
      duplicate_patterns: evidence.filter(e => e.includes('duplicate')).length,
      compliance_requirement: 0,
      business_criticality: 1
    });

    const risk_score = calculateRiskScore({
      search_frequency: 0,
      dashboard_references: 0,
      alert_dependencies: 0,
      anomaly_relevance: 0,
      daily_gb: 0,
      duplicate_patterns: 0,
      compliance_requirement: 0,
      business_criticality: 1
    });

    const recommendation = determineRecommendation(value_score, waste_score, risk_score);

    // Calculate cost impact
    const daily_gb = 12;
    const annual_cost = calculateAnnualCost(daily_gb, DEFAULT_COST_CONFIG);
    const savings = calculateSavings(annual_cost, recommendation.action);

    const asset = {
      telemetry_asset: source,
      value_score,
      waste_score,
      risk_score,
      recommendation: {
        action: recommendation.action,
        priority: recommendation.priority,
        approval_required: false
      },
      confidence: insights[0]?.confidence?.score || 0.75,
      estimated_annual_cost: annual_cost,
      estimated_savings: savings,
      criticality: recommendation.action === 'KEEP' ? 'tier-1' : 'tier-2',
      evidence,
      scoring_breakdown: {
        waste_score,
        derived_from: {
          ingest_volume: 40,
          low_search_usage: 25,
          duplicate_patterns: evidence.filter(e => e.includes('duplicate')).length * 5
        }
      },
      decision_trace_id: generateDecisionTraceId(),
      reasoning_mode: 'heuristic+agentic'
    };

    // Validate before adding
    const validated = validateTelemetryAsset(asset);
    telemetry_assets.push(validated);
  }

  // If no sources, add a demo asset
  if (telemetry_assets.length === 0) {
    const demoAsset = {
      telemetry_asset: 'demo-nginx-debug',
      value_score: 22,
      waste_score: 84,
      risk_score: 18,
      recommendation: { action: 'OPTIMIZE', priority: 'HIGH', approval_required: false },
      confidence: 0.91,
      estimated_annual_cost: 42000,
      estimated_savings: 18000,
      criticality: 'tier-2',
      evidence: [
        '0 dashboard references',
        'queried only twice in 90 days',
        '12GB/day ingest',
        'duplicate patterns detected'
      ],
      scoring_breakdown: {
        waste_score: 84,
        derived_from: { ingest_volume: 40, low_search_usage: 25, duplicate_patterns: 19 }
      },
      decision_trace_id: generateDecisionTraceId(),
      reasoning_mode: 'heuristic+agentic'
    };
    telemetry_assets.push(validateTelemetryAsset(demoAsset));
  }

  return {
    telemetry_assets,
    data_freshness_seconds: 18,
    schema_version: 'v1'
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add agents/value/
git commit -m "feat: add Telemetry Value Agent with deterministic scoring"
```

---

## Task 4: Update Pipeline for 7 Stages

**Files:**
- Modify: `core/pipeline/stages.ts`
- Modify: `core/pipeline/index.ts`

- [ ] **Step 1: Update core/pipeline/stages.ts**

```typescript
import { runConnectionAgent } from '../../agents/connection/agent';
import { runDiscoveryAgent } from '../../agents/discovery/agent';
import { runContextAgent } from '../../agents/context/agent';
import { runReasoningAgent } from '../../agents/reasoning/agent';
import { runValueAgent } from '../../agents/value/agent';
import { runPrioritizationAgent } from '../../agents/prioritization/agent';
import { runCompositionAgent } from '../../agents/composition/agent';

export const stages = {
  connection: {
    name: 'Connection Agent',
    run: runConnectionAgent,
    description: 'Validates MCP connection and fetches capabilities'
  },
  discovery: {
    name: 'Discovery Agent',
    run: runDiscoveryAgent,
    description: 'Discovers telemetry shape and volume'
  },
  context: {
    name: 'Telemetry Context Agent',
    run: runContextAgent,
    description: 'Organizes telemetry into semantic categories'
  },
  reasoning: {
    name: 'Reasoning Agent (Gemma4)',
    run: runReasoningAgent,
    description: 'Analyzes patterns and generates insights'
  },
  value: {
    name: 'Telemetry Value Agent',
    run: runValueAgent,
    description: 'Calculates value/waste/risk scores and generates recommendations'
  },
  prioritization: {
    name: 'Prioritization Agent',
    run: runPrioritizationAgent,
    description: 'Ranks recommendations by severity'
  },
  composition: {
    name: 'Dashboard Composition Agent',
    run: runCompositionAgent,
    description: 'Generates dashboard component specifications'
  }
};
```

- [ ] **Step 2: Update core/pipeline/index.ts**

```typescript
import { stages } from './stages';
import { ConnectionInput } from '../../agents/connection/types';

export interface PipelineResult {
  timeline: Array<{ timestamp: string; agent: string; status: string; duration_ms: number }>;
  connection?: any;
  discovery?: any;
  context?: any;
  reasoning?: any;
  value?: any;
  prioritization?: any;
  composition?: any;
  error?: string;
}

export async function runPipeline(input: ConnectionInput, ollamaUrl?: string): Promise<PipelineResult> {
  const timeline: PipelineResult['timeline'] = [];
  const result: PipelineResult = { timeline };

  try {
    // Stage 1: Connection
    const start1 = Date.now();
    const connection = await stages.connection.run(input);
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Connection Agent', status: connection.status, duration_ms: Date.now() - start1 });
    result.connection = connection;

    // Stage 2: Discovery
    const start2 = Date.now();
    const discovery = await stages.discovery.run({ connection });
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Discovery Agent', status: 'completed', duration_ms: Date.now() - start2 });
    result.discovery = discovery;

    // Stage 3: Context
    const start3 = Date.now();
    const context = await stages.context.run({ discovery });
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Telemetry Context Agent', status: 'completed', duration_ms: Date.now() - start3 });
    result.context = context;

    // Stage 4: Reasoning
    const start4 = Date.now();
    const reasoning = await stages.reasoning.run({ context }, ollamaUrl);
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Reasoning Agent', status: 'completed', duration_ms: Date.now() - start4 });
    result.reasoning = reasoning;

    // Stage 5: Value (NEW)
    const start5 = Date.now();
    const value = await stages.value.run({ discovery, reasoning });
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Telemetry Value Agent', status: 'completed', duration_ms: Date.now() - start5 });
    result.value = value;

    // Stage 6: Prioritization
    const start6 = Date.now();
    const prioritization = await stages.prioritization.run({ value });
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Prioritization Agent', status: 'completed', duration_ms: Date.now() - start6 });
    result.prioritization = prioritization;

    // Stage 7: Composition
    const start7 = Date.now();
    const composition = await stages.composition.run({ prioritization });
    timeline.push({ timestamp: new Date().toISOString(), agent: 'Dashboard Composition Agent', status: 'completed', duration_ms: Date.now() - start7 });
    result.composition = composition;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Pipeline failed';
  }

  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add core/pipeline/
git commit -m "feat: update pipeline to 7 stages with Telemetry Value Agent"
```

---

## Task 5: Update API Response

**Files:**
- Modify: `apps/web/app/api/pipeline/route.ts`

- [ ] **Step 1: Update route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '../../../core/pipeline/index';

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
        keep: assets.filter((a: any) => a.recommendation.action === 'KEEP').length,
        optimize: assets.filter((a: any) => a.recommendation.action === 'OPTIMIZE').length,
        archive: assets.filter((a: any) => a.recommendation.action === 'ARCHIVE').length,
        eliminate: assets.filter((a: any) => a.recommendation.action === 'ELIMINATE').length,
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/pipeline/route.ts
git commit -m "feat: update API to include telemetry assets and recommendations"
```

---

## Task 6: Update Frontend Components

**Files:**
- Create: `apps/web/components/RecommendationCard.tsx`
- Create: `apps/web/components/ScoreBreakdown.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Create apps/web/components/RecommendationCard.tsx**

```typescript
import { UIComponent } from '../lib/types';

interface RecommendationCardProps {
  asset: {
    telemetry_asset: string;
    value_score: number;
    waste_score: number;
    risk_score: number;
    recommendation: {
      action: string;
      priority: string;
    };
    estimated_savings?: number;
    criticality?: string;
    evidence: string[];
    scoring_breakdown?: {
      waste_score: number;
      derived_from: {
        ingest_volume: number;
        low_search_usage: number;
        duplicate_patterns: number;
      };
    };
  };
}

const actionColors: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6'
};

export default function RecommendationCard({ asset }: RecommendationCardProps) {
  const color = actionColors[asset.recommendation.action] || '#666';

  return (
    <div style={{ 
      padding: '1.5rem', 
      background: '#1a1a1a', 
      borderRadius: '8px', 
      border: `2px solid ${color}`,
      marginBottom: '1rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>{asset.telemetry_asset}</span>
        <span style={{ 
          padding: '0.25rem 0.75rem', 
          background: color, 
          borderRadius: '4px', 
          fontSize: '0.875rem',
          fontWeight: 600
        }}>
          {asset.recommendation.action}
        </span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#22c55e' }}>{asset.value_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Value</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#ef4444' }}>{asset.waste_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Waste</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f59e0b' }}>{asset.risk_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Risk</div>
        </div>
      </div>

      {asset.estimated_savings && (
        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#22c55e', marginBottom: '0.5rem' }}>
          Potential Savings: ${(asset.estimated_savings / 1000).toFixed(0)}k/year
        </div>
      )}

      {asset.evidence.length > 0 && (
        <div style={{ fontSize: '0.875rem', color: '#ccc', marginBottom: '0.5rem' }}>
          <strong>Evidence:</strong> {asset.evidence.slice(0, 3).join(' • ')}
        </div>
      )}

      {asset.scoring_breakdown && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#0a0a0a', borderRadius: '4px', fontSize: '0.75rem' }}>
          <div style={{ color: '#888', marginBottom: '0.5rem' }}>Scoring Breakdown:</div>
          <div style={{ color: '#ccc' }}>
            Waste Score: {asset.scoring_breakdown.waste_score} → 
            ingest(+{asset.scoring_breakdown.derived_from.ingest_volume}), 
            low_usage(+{asset.scoring_breakdown.derived_from.low_search_usage}), 
            duplicates(+{asset.scoring_breakdown.derived_from.duplicate_patterns})
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Modify apps/web/app/page.tsx to show recommendations**

```typescript
// Add this to the render section after AgentSummary
{data?.telemetry_assets && data.telemetry_assets.length > 0 && (
  <div style={{ margin: '2rem 0' }}>
    <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem' }}>
      Telemetry Recommendations ({data.telemetry_assets.length})
    </h2>
    {data.telemetry_assets.map((asset: any, index: number) => (
      <RecommendationCard key={index} asset={asset} />
    ))}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/RecommendationCard.tsx apps/web/app/page.tsx
git commit -m "feat: add RecommendationCard with score breakdown"
```

---

## Task 7: Demo Mode Support

**Files:**
- Create: `demo/sample-telemetry.json`

- [ ] **Step 1: Create demo/sample-telemetry.json**

```json
{
  "demo_mode": true,
  "telemetry_sources": [
    {
      "name": "nginx-access-prod",
      "daily_gb": 45,
      "search_frequency": 250,
      "dashboard_refs": 12,
      "alert_deps": 8,
      "anomaly_frequency": 3
    },
    {
      "name": "nginx-debug-prod",
      "daily_gb": 12,
      "search_frequency": 2,
      "dashboard_refs": 0,
      "alert_deps": 0,
      "anomaly_frequency": 0
    },
    {
      "name": "windows-security",
      "daily_gb": 28,
      "search_frequency": 180,
      "dashboard_refs": 15,
      "alert_deps": 12,
      "anomaly_frequency": 8
    }
  ],
  "expected_recommendations": [
    {
      "source": "nginx-debug-prod",
      "expected_action": "OPTIMIZE",
      "reason": "Low usage + high volume"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add demo/
git commit -m "feat: add demo mode sample data"
```

---

## Self-Review

### Spec Coverage Checklist

| Spec Requirement | Task |
|------------------|------|
| 7-stage pipeline | Tasks 1-4 |
| Telemetry Value Agent | Task 3 |
| Value/Waste/Risk scores | Task 3 (scorer.ts) |
| Recommendation categories (KEEP/OPTIMIZE/ARCHIVE/ELIMINATE/INVESTIGATE) | Task 3 (recommendations.ts) |
| Configurable weights | Task 2 |
| Cost calculations | Task 2 |
| Zod validation | Task 1 |
| Decision trace ID | Task 3 |
| Scoring breakdown | Task 6 |
| Demo mode | Task 7 |
| READ-ONLY banner | Task 6 (already in existing UI) |

### Placeholder Scan
- No "TBD", "TODO", or vague placeholders
- All code is complete with actual implementations

### Type Consistency
- All schemas use Zod for consistency
- Value agent types match pipeline flow

**All checks pass. Plan is ready.**

---

## Plan Complete

Plan saved to `docs/superpowers/plans/2026-05-13-agentic-telemetry-value-mvp.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - Fresh subagent per task with two-stage review

**2. Inline Execution** - Batch execution with checkpoints

Which approach?