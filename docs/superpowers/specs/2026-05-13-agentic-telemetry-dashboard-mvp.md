# Agentic Telemetry Dashboard MVP - Specification

## Product Identity

**Purpose**: Convert static telemetry dashboards into explainable agentic reasoning systems.

**Tagline**: "Minimal Explainable Agentic Telemetry Runtime"

---

## 1. Architecture Overview

This MVP demonstrates how traditional telemetry dashboards can evolve into **explainable agentic reasoning systems**.

```
User Input (MCP URL + Token)
         ↓
┌─────────────────────────────────────────────────────────┐
│  VISIBLE AGENTIC SEQUENTIAL PIPELINE                   │
│                                                         │
│  Connection Agent → Discovery → Context → Reasoning    │
│      → Prioritization → UI Spec                        │
└─────────────────────────────────────────────────────────┘
         ↓
Dashboard Renderer ← Decision Trace Panel
```

**Implementation**: Sequential async functions with lightweight LangGraph stage orchestration. No distributed agents or autonomous multi-agent coordination in V1.

**Constraint**: V1 is read-only. No remediation, write-back operations, or autonomous changes.

---

## 2. Agent Pipeline

### 2.1 Connection Agent

**Responsibility**: Validate MCP, verify token, fetch capabilities

**Input**: `{ mcp_url, token }`

**Output**:
```json
{
  "status": "connected" | "degraded" | "expired" | "no_access" | "partial",
  "indexes": ["main", "security"],
  "sources": 143,
  "latency_ms": 120,
  "capabilities": { "search": true, "stats": true },
  "schema_version": "v1"
}
```

### 2.2 Discovery Agent

**Responsibility**: Discover telemetry shape

**Input**: Connection output

**Output**:
```json
{
  "high_volume_sources": ["nginx", "aws_cloudtrail"],
  "error_sources": ["auth-service", "api-gateway"],
  "critical_indexes": ["security", "infrastructure"],
  "telemetry_summary": {
    "total_indexes": 18,
    "total_sources": 143,
    "daily_gb_estimate": 250
  }
}
```

### 2.3 Telemetry Context Agent (formerly Classification Agent)

**Responsibility**: Organize telemetry meaning, build semantic context

**Input**: Discovery output

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
  }
}
```

### 2.4 Reasoning Agent (Gemma4)

**Responsibility**: Analyze and generate insights with evidence

**Input**: Context output

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
      "supporting_metrics": ["error_rate", "request_count", "p99_latency"],
      "trigger_conditions": ["error_rate > threshold", "recent_deployment=true"],
      "correlation": "deployment_event"
    }
  ]
}
```

### 2.5 Prioritization Agent

**Responsibility**: Rank insights into HIGH/MEDIUM/LOW

**Input**: Reasoning output

**Output**:
```json
{
  "prioritized": {
    "high": [...],
    "medium": [...],
    "low": [...]
  },
  "severity_scores": {
    "nginx_error_spike": 0.92,
    "debug_log_waste": 0.78
  }
}
```

### 2.6 UI Spec Generator

**Responsibility**: Generate JSON schema for dashboard components

**Input**: Prioritization output

**Output**:
```json
{
  "schema_version": "v1",
  "components": [
    {
      "type": "metric_card",
      "title": "Telemetry Waste",
      "value": "$42k/year",
      "priority": "high",
      "reasoning": "High ingest cost with no dashboard references",
      "evidence": ["daily_gb: 50", "last_reference: 90 days"],
      "source_queries": ["index=* | stats sum(kb) by sourcetype"],
      "supporting_metrics": ["daily_gb", "annual_cost"],
      "trigger_conditions": ["cost > 10000 AND references = 0"]
    },
    {
      "type": "line_chart",
      "title": "API Error Trend",
      "data_source": "search_results",
      "reasoning": "Sharp increase in last 4h",
      "raw_query": "index=api status=5* | timechart span=1h count",
      "evidence": ["4h trend: 50 → 150 → 400"],
      "source_queries": ["index=api status=5* | timechart span=1h count"],
      "supporting_metrics": ["error_count", "error_rate"]
    }
  ]
}
```

---

## 3. UI Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header: MCP Status | Gemma4 | Last Refresh | Agent Health  │
├────────────────────────────────────────────────────────────┤
│ [Observe] [Analyze] [Reason] [Recommend] [Explain]       │
├────────────────────────────────────────────────────────────┤
│ AGENTIC TIMELINE                                           │
│ [10:41] Discovery: found spike in nginx-prod              │
│ [10:42] Context: classified as errors category            │
│ [10:43] Reasoning: correlated with recent deployment      │
│ [10:44] Prioritization: HIGH severity (92%)              │
├────────────────────────────────────────────────────────────┤
│ AGENT SUMMARY                                               │
│ • Analyzed 18 indexes                                      │
│ • Detected 4 anomalies                                     │
│ • Identified $42k waste                                    │
│ • Generated 7 recommendations                              │
├────────────────────────────────────────────────────────────┤
│ DYNAMIC COMPONENTS                                         │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│ │ Metric Card │ │ Line Chart  │ │ Insight Card│           │
│ └─────────────┘ └─────────────┘ └─────────────┘           │
├────────────────────────────────────────────────────────────┤
│ WHY THIS WAS SHOWN                                         │
│ • High ingest cost ($42k/yr)                               │
│ • Anomaly detected in last 4h                             │
│ • No dashboard references in 90 days                      │
│ Confidence: 89%                                           │
│ [View Raw Data]                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 4. UI Component Types (V1 Limited Set)

| Component | Description |
|-----------|-------------|
| `metric_card` | Single value + label (e.g., "$42k/year") |
| `line_chart` | Time-series visualization |
| `bar_chart` | Categorical comparison |
| `table` | Tabular data with columns |
| `insight_card` | Text insight with priority badge |
| `recommendation_card` | Actionable recommendation |
| `timeline_event` | Single event in the agent timeline |
| `status_banner` | Connection/agent status indicator |

**No arbitrary UI generation** - this prevents prompt instability and rendering bugs.

### 4.1 Enhanced Confidence Standard

All insights use this confidence structure:

```json
{
  "confidence": {
    "score": 0.92,
    "factors": [
      "high anomaly correlation",
      "strong telemetry freshness",
      "multiple corroborating signals"
    ]
  }
}
```

### 4.2 Raw Telemetry Drawer

Every component includes "View Source Data" with:
- SPL query used
- Source index
- Sample events
- Metric source

---

## 5. Trust Features

### 5.1 Agent Confidence Visualization

Every insight shows:
- Confidence percentage (e.g., "89%")
- Contributing factors ("anomaly correlation", "ingest spike", "failed searches")

### 5.2 Raw Telemetry Drawer

Every component includes:
- "View Source Data" link
- SPL query used
- Raw metric sample

### 5.3 Evidence Chain

Each insight carries:
- `evidence[]`: Supporting data points
- `source_queries[]`: SPL queries that generated the insight
- `trigger_conditions[]`: What caused this to be flagged

---

## 6. MCP Resilience States

| State | Meaning | UI Treatment |
|-------|---------|--------------|
| `CONNECTED` | Healthy, full access | Green status |
| `DEGRADED` | Slow/high latency | Yellow status |
| `AUTH_FAILED` | Token invalid/expired | Red + re-auth prompt |
| `NO_INDEX_ACCESS` | Permission denied | Red + config help |
| `NO_DATA` | Connected but no data | Yellow + note |
| `PARTIAL_DATA` | Some indexes accessible | Yellow + note |

---

## 7. Tech Stack (V1)

| Layer | Technology |
|-------|------------|
| UI | Next.js (App Router) + Recharts |
| Agent Runtime | Sequential async functions with lightweight LangGraph |
| LLM | Ollama + Gemma4 (local) |
| Splunk Access | MCP (via SSE) |
| State | In-memory |
| Container | Docker Compose |

**No**: PostgreSQL, Redis, Kafka, Vector DB, Auth systems, Multi-agent swarm.

**Core Constraint**: No hardcoded business logic or static dashboard rules. Reasoning and prioritization must be agent-driven.

---

## 8. Folder Structure

```
.
├── apps/
│   └── web/              # Next.js frontend
├── core/
│   ├── pipeline/         # Sequential agent execution
│   ├── prompts/          # Agent prompts
│   ├── schemas/         # JSON schemas
│   └── renderers/       # Component renderers
├── agents/
│   ├── connection/      # Connection agent
│   ├── discovery/       # Discovery agent
│   ├── context/         # Telemetry context agent
│   ├── reasoning/      # Reasoning agent (Gemma4)
│   ├── prioritization/  # Prioritization agent
│   └── ui-spec/         # UI spec generator
├── tools/
│   └── splunk-mcp/      # MCP tool definitions
└── docker/
    └── docker-compose.yml
```

---

## 9. MVP Timeline (4 Days)

| Day | Focus |
|-----|-------|
| Day 1 | MCP connection + Ollama integration + basic Next.js UI |
| Day 2 | Telemetry fetch + prompt engineering + dynamic UI JSON |
| Day 3 | Chart rendering + reasoning panel + anomaly prioritization |
| Day 4 | Dockerization + onboarding flow + polish |

---

## 10. Success Criteria

1. User can connect via MCP URL + token
2. Pipeline runs sequentially with visible timeline
3. Each component shows "Why This Was Shown"
4. Confidence scores displayed for all insights
5. Raw telemetry accessible for verification
6. Docker Compose deploys everything locally
7. Gemma4 runs locally via Ollama

---

## 11. Out of Scope (V1)

- Multi-tenant complexity
- Full RBAC
- Jira/ServiceNow automation
- Auto-remediation
- Multi-agent swarms
- Complex orchestration
- Production-grade auth
- Write-back operations
- Autonomous changes

---

## 12. Agent Maturity Level

This MVP operates at **Level 2-3** (Observability → Recommendations) on the autonomous operations maturity spectrum:
- Observability: Yes (telemetry access)
- Analysis: Yes (pattern detection)
- Recommendations: Yes (prioritized insights)
- Autonomous Operations: No (read-only, no remediation)

---

*Schema version: v1*
*Generated: 2026-05-13*