# DEMO Release Gate (Go/No-Go)

## Hard gate checklist
- [ ] `npm run cleanup:test` passed
- [ ] `npm run verify:clean` passed (all zero)
- [ ] `npm run test:contract` passed
- [ ] `npm run test:fixtures` passed
- [ ] `npm run test:agent` passed
- [ ] `npm run test:pipeline` passed
- [ ] `npm run test:ui` passed
- [ ] Dashboard loads without runtime crash
- [ ] Refresh does not get stuck
- [ ] No blocking API failures for core paths
- [ ] AI recommendation evidence visible
- [ ] At least one HITL action verified in UI + API audit trail

## Current execution evidence
- `evidence/test_contract_output.txt`
- `evidence/test_fixtures_output.txt`
- `evidence/test_agent_output.txt`
- `evidence/test_pipeline_output.txt`
- `evidence/test_ui_output.txt`
- `evidence/dashboard_audit_report_fresh.md`
- `evidence/network.har`

## Go rule
GO only if all hard gates pass and final screen is free of demo/mock/hardcoded placeholders.

## No-go rule
NO-GO if any of the following is true:
- fixture cleanliness check fails
- core endpoint regression (401/500 on required route)
- runtime exception visible
- AI/HITL sections have no verifiable data path
