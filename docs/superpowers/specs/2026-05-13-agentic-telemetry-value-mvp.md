# Agentic Telemetry Value MVP - Specification

## Product Identity

**Purpose**: Convert static telemetry dashboards into explainable agentic telemetry valuation systems.

**Tagline**: "Explainable Agentic Telemetry Value Engine"

---

## 1. Architecture Overview

This MVP demonstrates how traditional telemetry dashboards can evolve into **explainable agentic valuation systems** that reason about telemetry ROI/TCO.

```
User Input (MCP URL + Token)
         ↓
┌─────────────────────────────────────────────────────────────┐
│  REFRESH PATH (User Triggered)                             │
│  POST /api/cache → Splunk MCP → Aggregate → PostgreSQL     │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  DISPLAY PATH (Cache-First)                                │
│  GET /api/pipeline → PostgreSQL → Dashboard                │
└─────────────────────────────────────────────────────────────┘
         ↓
Dashboard Renderer ← Decision Trace Panel
```

**Data Policy**: ZERO mock data, ZERO demo mode, ZERO fallback values. Empty state shown when no data.

**Implementation**: Sequential async functions. No distributed agents in V1.

**Constraint**: V1 is read-only. No remediation, write-back operations, or autonomous changes.

---

## 2. Agent Pipeline (7 Stages)

### 2.1 Connection Agent

**Responsibility**: Validate MCP, verify token, fetch capabilities

**Output**:
```json
{
  "status": "CONNECTED" | "DEGRADED" | "AUTH_FAILED" | "NO_INDEX_ACCESS" | "NO_DATA" | "PARTIAL_DATA",
  "indexes": ["main", "security"],
  "sources": 143,
  "latency_ms": 120,
  "capabilities": { "search": true, "stats": true },
  "schema_version": "v1"
}
```

### 2.2 Discovery Agent

**Responsibility**: Discover telemetry shape and volume

**Output**:
```json
{
  "high_volume_sources": ["nginx", "aws_cloudtrail"],
  "error_sources": ["auth-service"],
  "critical_indexes": ["security", "infrastructure"],
  "telemetry_summary": {
    "total_indexes": 18,
    "total_sources": 143,
    "daily_gb_estimate": 250
  },
  "data_freshness_seconds": 18
}
```

### 2.3 Telemetry Context Agent

**Responsibility**: Organize telemetry into semantic categories

**Output**:
```json
{
  "categories": {
    "health": ["cpu_usage", "memory_usage"],
    "errors": ["error_rate", "exception_count"],
    "latency": ["p50_latency", "p99_latency"],
    "security": ["auth_failures", "intrusion_attempts"],
    "waste": ["unused_logs", "debug_volume"],
    "anomalies": ["spike_detected", "pattern_shift"]
  },
  "schema_version": "v1"
}
```

### 2.4 Reasoning Agent (Gemma4)

**Responsibility**: Analyze patterns and generate insights with evidence

**Output**:
```json
{
  "insights": [
    {
      "insight": "nginx-prod has abnormal spike in 5xx errors",
      "confidence": {
        "score": 0.89,
        "factors": ["anomaly correlation", "high volume spike", "recent deployment"]
      },
      "evidence": ["3x increase in 4h", "correlated with deployment"],
      "source_queries": ["index=nginx | stats count by status"],
      "supporting_metrics": ["error_rate", "request_count"]
    }
  ],
  "reasoning_mode": "heuristic+agentic",
  "schema_version": "v1"
}
```

### 2.5 Telemetry Value Agent (NEW)

**Responsibility**: Calculate value/waste/risk scores and generate recommendations

**Input**: Reasoning output + Discovery metadata

**Output**:
```json
{
  "telemetry_assets": [
    {
      "telemetry_asset": "nginx-debug-prod",
      "value_score": 22,
      "waste_score": 84,
      "risk_score": 18,
      "recommendation": {
        "action": "OPTIMIZE",
        "priority": "HIGH",
        "approval_required": false
      },
      "confidence": 0.91,
      "estimated_annual_cost": 42000,
      "estimated_savings": 18000,
      "criticality": "tier-2",
      "evidence": [
        "0 dashboard references",
        "queried only twice in 90 days",
        "12GB/day ingest",
        "duplicate patterns detected"
      ],
      "scoring_breakdown": {
        "waste_score": 84,
        "derived_from": {
          "ingest_volume": 40,
          "low_search_usage": 25,
          "duplicate_patterns": 19
        }
      },
      "decision_trace_id": "trace-abc-123",
      "reasoning_mode": "heuristic+agentic"
    }
  ],
  "schema_version": "v1"
}
```

### 2.6 Prioritization Agent

**Responsibility**: Rank recommendations by severity and business impact

**Output**:
```json
{
  "prioritized": {
    "high": [...],
    "medium": [...],
    "low": [...]
  },
  "severity_scores": {},
  "schema_version": "v1"
}
```

### 2.7 Dashboard Composition Agent (formerly UI Spec Generator)

**Responsibility**: Generate dashboard component specifications

**Output**:
```json
{
  "schema_version": "v1",
  "components": [
    {
      "type": "recommendation_card",
      "title": "OPTIMIZE: nginx-debug-prod",
      "recommendation": "OPTIMIZE",
      "priority": "HIGH",
      "estimated_savings": "$18k/year",
      "value_score": 22,
      "reasoning": "High waste score (84) with low operational value",
      "evidence": ["0 dashboard references", "queried twice in 90 days"],
      "criticality": "tier-2"
    }
  ]
}
```

---

## 3. Score Dimensions (V1 - 3 Only)

### 3.1 Value Score

**Question**: How operationally useful is this telemetry?

**Formula (deterministic)**:
```
value_score = (search_usage × 0.35) + (dashboard_refs × 0.20) + (alert_deps × 0.25) + (anomaly_relevance × 0.20)
```

### 3.2 Waste Score

**Question**: How much cost with low utility?

**Formula (deterministic)**:
```
waste_score = min(100, (ingest_volume × low_usage_factor × redundancy_factor))
```

### 3.3 Risk Score

**Question**: What happens if modified/removed?

**Formula (deterministic)**:
```
risk_score = (alert_dependency × 0.50) + (compliance_requirement × 0.30) + (business_criticality × 0.20)
```

---

## 4. Recommendation Categories (V1)

| Action | Description | Score Threshold |
|--------|-------------|-----------------|
| **KEEP** | High value, critical operations | Value ≥ 65 |
| **OPTIMIZE** | Moderate waste, potential savings | Waste ≥ 50 AND Value < 65 |
| **ARCHIVE** | Low usage, cold storage candidate | Value < 30 AND Risk < 40 |
| **ELIMINATE** | High waste, no value | Waste ≥ 80 AND Value < 20 |
| **INVESTIGATE** | Anomalous patterns, needs review | Anomaly detected + low confidence |

---

## 5. Configurable Weights

```typescript
interface ValueWeights {
  search_usage: number;        // default: 0.35
  dashboard_refs: number;      // default: 0.20
  alert_dependency: number;    // default: 0.25
  anomaly_relevance: number;   // default: 0.20
}

interface CostConfig {
  cost_per_gb_per_day: number;  // default: 10 (configurable)
  retention_days: number;       // default: 90
}
```

---

## 6. Data Fetch Flow

### 6.1 Refresh (User Triggered)
- User enters MCP URL + Token in configuration panel
- Clicks "Fetch & Cache" → POST /api/cache
- Splunk MCP queried → results aggregated → stored in PostgreSQL

### 6.2 Display (Cache-First)
- Dashboard load → GET /api/pipeline
- Reads from PostgreSQL only (no MCP calls in display path)
- Shows empty state when cache is empty

---

## 7. UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: MCP Status | Ollama | Last Refresh | READ-ONLY MODE     │
├─────────────────────────────────────────────────────────────────┤
│  [Observe] [Analyze] [Value] [Recommend] [Explain]             │
├─────────────────────────────────────────────────────────────────┤
│  AGENTIC TIMELINE                                               │
│  10:41 → Discovery: found high-volume source                    │
│  10:42 → Context: classified as DEBUG logs                      │
│  10:43 → Reasoning: low operational relevance                   │
│  10:44 → Value: assigned 22/100 value score                      │
│  10:45 → Prioritization: OPTIMIZE (89% confidence)              │
│  10:46 → Composition: generated recommendation card             │
├─────────────────────────────────────────────────────────────────┤
│  RECOMMENDATIONS                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ OPTIMIZE: nginx-debug-prod                                  ││
│  │ Value: 22/100 | Waste: 84/100 | Risk: 18/100               ││
│  │ Savings: $18k/year | Criticality: tier-2                   ││
│  │                                                             ││
│  │ Reasoning:                                                  ││
│  │ - 0 dashboard references                                    ││
│  │ - Queried only twice in 90 days                             ││
│  │ - 12GB/day ingest                                          ││
│  │ - Duplicate patterns detected                               ││
│  │                                                             ││
│  │ Scoring Breakdown:                                          ││
│  │   Waste Score: 84 → ingest_volume(+40), low_usage(+25)     ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  WHY THIS RECOMMENDATION                                        │
│  High waste score (84) with low operational value (22)          │
│  Confidence: 91%                                                │
│  Decision Trace ID: trace-abc-123                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. UI Component Types (V1)

| Component | Description |
|-----------|-------------|
| `metric_card` | Single value + label |
| `line_chart` | Time-series visualization |
| `bar_chart` | Categorical comparison |
| `recommendation_card` | Actionable recommendation with scoring |
| `score_breakdown` | Transparent scoring derivation |
| `timeline_event` | Agent step in timeline |
| `status_banner` | Connection/agent status |

---

## 9. Trust Features

### 9.1 Confidence Scoring with Factors

```json
{
  "confidence": {
    "score": 0.91,
    "factors": ["high waste correlation", "low usage patterns", "clear evidence"]
  }
}
```

### 9.2 Evidence Chain

Every recommendation carries:
- `evidence[]`: Supporting data points
- `source_queries[]`: SPL queries used
- `scoring_breakdown{}`: How score was derived
- `decision_trace_id`: Unique audit identifier

### 9.3 Read-Only Banner

UI displays:
> "READ-ONLY ANALYSIS MODE - No automated actions executed"

---

## 10. MCP Resilience States

| State | Meaning |
|-------|---------|
| `CONNECTED` | Healthy, full access |
| `DEGRADED` | Slow/high latency |
| `AUTH_FAILED` | Token invalid |
| `NO_INDEX_ACCESS` | Permission denied |
| `NO_DATA` | Connected but no data |
| `PARTIAL_DATA` | Some indexes accessible |

---

## 11. Tech Stack (V1)

| Layer | Technology |
|-------|------------|
| UI | Next.js (App Router) + Recharts + Tailwind CSS |
| Agent Runtime | Sequential async functions |
| LLM | Ollama + Gemma4:e2b (local) |
| Splunk Access | MCP (HTTP REST API) |
| Cache | PostgreSQL (aggregated data, not raw events) |
| Container | Docker Compose |

**Data Policy**: Real Splunk data only. No mock data, no demo fallback. Empty state when no cache exists.

---

## 12. Folder Structure

```
.
├── apps/
│   ├── api/                  # API services and routes
│   │   ├── services/         # splunk-client, aggregation-service
│   │   ├── repositories/     # telemetry-repository, trace-repository
│   │   └── lib/             # db connection pool
│   └── web/                 # Next.js frontend
├── core/
│   ├── pipeline/            # runPipelineFromCache (cache-first)
│   ├── scoring/             # deterministic classification
│   └── schemas/             # JSON schemas
├── infrastructure/
│   ├── schema.sql           # PostgreSQL schema (4 tables, 12+ indexes)
│   └── docker-compose.yml
└── docs/                    # Specifications and plans
```

---

## 13. V1 Out of Scope

- Multi-tenant complexity
- Full RBAC
- Auto-remediation
- External integrations (CMDB, FinOps)
- Complex alerting
- Production auth
- Write-back operations

---

## 14. Success Criteria

1. User can connect via MCP URL + token
2. Pipeline runs sequentially with visible timeline
3. Value/Waste/Risk scores calculated per telemetry asset
4. Recommendations include scoring breakdown
5. Confidence scores displayed with factors
6. Evidence chain traceable
7. Data fetched from real Splunk only (no mock data)
8. Cache-first architecture (PostgreSQL)
9. Empty state shown when no data available
10. Docker Compose deploys locally

---

## 15. Product Positioning

**Elevator Pitch**: "Convert static telemetry dashboards into explainable agentic telemetry valuation systems."

**Core Differentiator**: Not just showing telemetry - **reasoning about its value** with transparent scoring and audit trails.

---

---

## 16. Implementation Guidelines

### 16.1 Schema Freeze (CRITICAL)

Before implementation, freeze all JSON contracts:
- `TelemetryAsset` schema
- `Insight` schema
- `Evidence` schema
- `TimelineEvent` schema
- `Recommendation` schema
- `DashboardComponent` schema
- `DecisionTrace` schema

**Rule**: No schema changes after implementation begins without full review.

### 16.2 Schema Validation Layer

Use **Zod** for runtime validation:
```
Agent Output → Zod Schema Validation → Next Stage
```
This prevents malformed outputs from breaking the pipeline.

### 16.3 Deterministic Fallback Mode

If Gemma4 becomes unavailable:
- Fall back to heuristic-only scoring
- Display: "LLM unavailable — running deterministic telemetry valuation"
- Maintain full functionality without LLM

### 16.4 Prompt Versioning

Structure:
```
prompts/
  reasoning/v1/
  valuation/v1/
  prioritization/v1/
```

### 16.5 Explainability First Rule

**Principle**: If a recommendation cannot be explained clearly with evidence, it should NOT be surfaced as HIGH confidence.

### 16.6 Implementation Order

1. **Phase 1**: Schemas + Pipeline contracts (START HERE)
2. **Phase 2**: MCP integration
3. **Phase 3**: Telemetry normalization
4. **Phase 4**: Telemetry Value Agent
5. **Phase 5**: Reasoning quality
6. **Phase 6**: UI rendering

**Rationale**: This product is a reasoning engine, not a dashboard app.

---

## 17. UI Philosophy

Optimize for **clarity of reasoning**, not visual complexity.

- ✅ Calm, analytical, trustworthy
- ✅ Like Linear, Stripe, Datadog notebooks
- ❌ Avoid: Splunk classic, Grafana chaos, enterprise BI overload

---

*Schema version: v1*
*Generated: 2026-05-13*
*Product Identity: Explainable Agentic Telemetry Value Engine*
*Status: SPEC FROZEN - Ready for Implementation*