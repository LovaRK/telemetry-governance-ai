#!/usr/bin/env bash
# fresh-start.sh — wipe analysis data, keep Splunk credentials, restart everything
# Usage: bash scripts/fresh-start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         datasensAI — Fresh Start                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 0. Start Ollama if not running ─────────────────────────────
echo "▶ Checking Ollama (local LLM)..."
if ! pgrep -x ollama >/dev/null 2>&1; then
  echo "  Starting Ollama..."
  ollama serve > /tmp/ollama.log 2>&1 &
  sleep 4
fi
if curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "  ✓ Ollama running"
else
  echo "  ⚠ Ollama not responding — LLM pipeline will fail until Ollama starts"
fi

# ─── 1. Start containers if not running ─────────────────────────
echo "▶ Starting containers..."
SPLUNK_SECRET_ENCRYPTION_KEY=344b0b8bf906c500273b8dd91b9405844cf832918fb2e45d473a64c8a283b804 \
  docker compose -f "$COMPOSE_FILE" up -d 2>&1 | grep -v "^$"

# ─── 2. Wait for Postgres ────────────────────────────────────────
echo "▶ Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec docker-postgres-1 pg_isready -U telemetry -d telemetry_os >/dev/null 2>&1; then
    echo "  ✓ Postgres ready"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then echo "  ✗ Postgres timed out"; exit 1; fi
done

# ─── 3. Wipe analysis data — preserve tenants + credentials ─────
echo "▶ Clearing analysis data (Splunk credentials preserved)..."
docker exec -i docker-postgres-1 psql -U telemetry -d telemetry_os <<'SQL'
-- Clear all pipeline + analysis data
TRUNCATE TABLE
  pipeline_runs, pipeline_stage_events, pipeline_events, pipeline_executions,
  pipeline_replay_runs, telemetry_snapshots, telemetry_facts, agent_decisions,
  executive_kpis, job_queue, decision_history, decision_lineage, decision_traces,
  decision_drift_history, kpi_change_events, snapshot_metadata, cache_metadata,
  llm_health_history, llm_prompt_versions, recommendation_actions,
  governance_mutation_journal, governance_audit_snapshots, governance_telemetry,
  governance_operational_metrics, governance_ttl_sweep_log,
  confidence_calibration_log, recovery_milestones,
  normalization_variance, normalization_rollback_events,
  reanalysis_job_queue, queue_health_metrics,
  dashboard_truth_runs, dashboard_truth_failures,
  dashboard_validation_runs, dashboard_validation_failures,
  model_benchmarks, model_health_ledger, model_promotions,
  operator_sessions, operator_identity_mapping
CASCADE;

-- Clear search/field data tables (may not exist in all envs)
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE search_audit CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE security_coverage CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE field_usage CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'TRUNCATE TABLE quality_hotspots CASCADE';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Reset snapshot pointer (keep row, clear references)
UPDATE tenant_snapshot_pointer
SET active_run_id = NULL, active_snapshot_id = NULL, updated_at = NOW();

-- Reset LLM health cache counters
UPDATE llm_health_cache SET
  last_health_id = NULL, last_successful_poll_at = NULL,
  total_polls = 0, successful_polls = 0, failed_polls = 0
WHERE TRUE;

-- Restore governance model pointer (wiped by cascade)
-- approved_models and prompt_registry are preserved (not in the truncate list)
DO $$
DECLARE
  v_model_id UUID;
  v_prompt_id UUID;
  v_promotion_id UUID := '03c33333-3333-3333-3333-333333333333';
BEGIN
  SELECT model_id INTO v_model_id FROM approved_models WHERE status = 'APPROVED' LIMIT 1;
  SELECT prompt_id INTO v_prompt_id FROM prompt_registry WHERE approved = true LIMIT 1;
  IF v_model_id IS NOT NULL AND v_prompt_id IS NOT NULL THEN
    INSERT INTO model_promotions
      (promotion_id, new_model_id, new_prompt_id, new_contract,
       promoted_by, reason, runtime_snapshot)
    VALUES (v_promotion_id, v_model_id, v_prompt_id, 'v1',
            'fresh-start-bootstrap', 'Governance bootstrap after fresh start',
            '{"source":"fresh-start"}'::jsonb)
    ON CONFLICT (promotion_id) DO NOTHING;
    INSERT INTO active_model_pointer
      (tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version)
    VALUES ('SYSTEM', v_model_id, v_prompt_id, v_promotion_id, 'v1', 1)
    ON CONFLICT (tenant_id) DO UPDATE SET
      model_id = EXCLUDED.model_id, prompt_id = EXCLUDED.prompt_id,
      current_promotion_id = EXCLUDED.current_promotion_id,
      config_version = active_model_pointer.config_version + 1,
      updated_at = NOW();
    RAISE NOTICE 'Governance model pointer restored: %', v_model_id;
  ELSE
    RAISE WARNING 'No approved model found — run migrations to seed approved_models';
  END IF;
END $$;

-- Verify Splunk credentials are intact (show configured tenant)
SELECT
  '✓ Splunk credentials: ' ||
  COALESCE(splunk_api_url, 'NOT CONFIGURED') ||
  CASE WHEN splunk_username IS NOT NULL AND splunk_username != ''
       THEN ' (user: ' || splunk_username || ')' ELSE '' END AS status
FROM tenants
WHERE is_configured = true AND splunk_api_url IS NOT NULL
LIMIT 1;

-- Show count for unconfigured tenants (test fixtures)
SELECT count(*)::text || ' test tenants (unconfigured) also present' FROM tenants WHERE is_configured = false OR splunk_api_url IS NULL;
SQL

echo "  ✓ Analysis data cleared"

# ─── 4. Ensure cost default is $10/day ($3,650/yr) ──────────────
echo "▶ Ensuring cost default = \$10/GB/day (\$3,650/yr)..."
docker exec -i docker-postgres-1 psql -U telemetry -d telemetry_os -c \
  "UPDATE user_config SET cost_per_gb_per_day = 10.00, updated_at = NOW() WHERE config_key = 'default' AND cost_per_gb_per_day < 1;" \
  2>&1 | grep -v "^$" || true
echo "  ✓ Cost default confirmed"

# ─── 5. Wait for web service ─────────────────────────────────────
echo "▶ Waiting for web service (http://localhost:3002)..."
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3002/api/health 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "  ✓ Web service healthy"
    break
  fi
  sleep 3
  if [ "$i" -eq 40 ]; then
    echo "  ⚠ Web service not responding — check docker logs docker-web-1"
  fi
done

# ─── 6. Final status ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✓ Fresh start complete                          ║"
echo "║                                                  ║"
echo "║  Next steps:                                     ║"
echo "║  1. Open http://localhost:3002                   ║"
echo "║  2. Click ↺ Refresh to run the pipeline          ║"
echo "║  3. Wait ~90s for PARTIAL → READY                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Show health summary
curl -s http://localhost:3002/api/health 2>/dev/null | grep -o '"status":"[^"]*"' | head -3 || true
echo ""
