# v1.2-trust-stable — Certification Manifest

**Date:** 2026-05-23
**Commit:** `b2dc489`
**Tag:** `v1.2-trust-stable`

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | ✅ PASS |
| Contract tests (23 suites, 197 tests) | ✅ ALL PASS |
| E2E tests (55 tests) | ✅ ALL PASS |
| Docker healthy | ✅ |
| API health (`/api/health`) | ✅ |
| LLM settings (7/7 cases) | ✅ |

## Artifacts

| Path | Content |
|------|---------|
| `artifacts/runtime-qa/certification/phase-start-verify.txt` | Baseline gate results |
| `artifacts/runtime-qa/runtime-truth/refresh-soak-10x.json` | 10x refresh cycles |
| `artifacts/runtime-qa/runtime-truth/ui-state-matrix.md` | Cache state → UI mapping |
| `artifacts/runtime-qa/runtime-truth/governance-401-trace.json` | SSE noise analysis |
| `artifacts/runtime-qa/p3-validation/request-comparison-rerun.md` | P3 request reduction |
| `artifacts/runtime-qa/p3-validation/request-comparison-rerun.json` | P3 request metrics |
| `artifacts/runtime-qa/settings/local-first-certification.md` | Settings certification |
| `artifacts/PRODUCTION_CERTIFICATION_REPORT.md` | E2E certification report |

## Deferred Issues

| ID | Description | Severity |
|----|-------------|----------|
| STREAM-001 | SSE reconnect has no exponential backoff (fixed 5s) | Low |
| STREAM-002 | Auth safety-net gap on fetch exceptions | Low |
| STREAM-003 | Unhandled promise rejection noise in E2E logs | Low |
| STREAM-004 | EventSource can't set Authorization header in no-cors | Low |
| SPLUNK-001 | No real Splunk at localhost:8089 — refresh returns 500 | Blocked |

## Verification Command

```bash
npx tsc --noEmit && npx jest tests/contract/ --runInBand && npx playwright test
```
