# Local-First Settings Certification

## LLM Provider Settings (All 7 Cases)

| # | Test | Expected | Result | Status |
|---|---|---|---|---|
| 1 | GET default provider (fresh DB) | Returns `{ llmProvider: "local" }` | 200, provider=`local` | ✅ PASS |
| 2 | POST Anthropic with valid key (`sk-ant-...`) | 200 OK | 200 `{ ok: true }` | ✅ PASS |
| 3 | POST Anthropic with empty key `""` | 500 error | 500 "Anthropic API key is required" | ✅ PASS |
| 4 | POST Local (Ollama) | 200 OK | 200 `{ ok: true }` | ✅ PASS |
| 5 | Verify persist after set | Last value returned on GET | 200, returns `local` after setting local | ✅ PASS |
| 6 | POST Anthropic with null key | 500 error | 500 "API key is required" | ✅ PASS |
| 7 | Verify no silent cloud fallback after setting local | Returns local, no Anthropic | 200, `anthropicApiKey: null` | ✅ PASS |

## Data Truthfulness (No Mock/Injected Data)

| # | Test | Expected | Result | Status |
|---|---|---|---|---|
| 1 | Dashboard without Splunk config | No fake KPIs, shows connect screen | Cache-status returns `hasData: false` | ✅ PASS |
| 2 | Dashboard with config, no refresh | Truthful "Awaiting first refresh" | Cache-status `hasEverRefreshed: false` | ✅ PASS |
| 3 | Empty state components | Show "No data" not mock values | Verified in E2E test 01 (no-hardcoded-data) | ✅ PASS |
| 4 | Executive summary API | Returns DB data, no mock/demo | E2E test 06 `No hardcoded/mock/demo` PASS | ✅ PASS |
| 5 | Decision history | DB-backed, no stub | E2E test 06 Decision History uses DB | ✅ PASS |
| 6 | Trust layer status | DB-backed, no mock | E2E test 06 Trust Layer Status PASS | ✅ PASS |
| 7 | Queue health metrics | Real metrics, no fake | E2E test 06 Queue Health PASS | ✅ PASS |

## Field Name Consistency

Frontend (`settings/page.tsx:379`) sends: `{ llmProvider, anthropicApiKey, anthropicModel }`
Backend (`llm/route.ts:21`) reads: `body.llmProvider`, `body.anthropicApiKey`, `body.anthropicModel` — **MATCH** ✅

## Conclusion

All 7 LLM settings cases pass. All data truthfulness checks pass. The frontend-backend field names are consistent. No mock/hardcoded data detected in any API response.

**Certified**: local-first policy is enforced — cloud provider requires explicit key, no silent fallback, no mock data.
