/**
 * Deprecated synthetic pipeline worker.
 *
 * This worker used seeded/mock writes for telemetry_snapshots/executive_kpis.
 * Phase 1A disables that path; live pipeline uses docker/worker.ts only.
 */

console.log('[Worker] apps/workers/pipeline-worker.ts is disabled by design. Use docker/worker.ts for live pipeline jobs.');
