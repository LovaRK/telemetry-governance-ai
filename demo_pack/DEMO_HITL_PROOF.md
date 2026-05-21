# DEMO Human-in-the-Loop (HITL) Proof

## Objective
Prove governance decisions can be reviewed and mutated by a human actor with auditability.

## HITL scenario
1. Select one recommendation in governance/review queue.
2. Perform one action:
- Approve OR Reject OR Defer.
3. Verify immediate state changes in UI.
4. Verify API/history/timeline reflects action.

## Required checks
- Actor attribution present (user identity/email/role where exposed).
- Mutation lifecycle timeline updates.
- Replay/history endpoint reflects decision state transition.
- Queue status changes (pending/review counts updated).

## API evidence points
- `/api/governance/mutations`
- `/api/governance/mutation-lifecycle`
- `/api/recommendations` and `/api/recommendations/[id]`
- `/api/governance/history/[indexName]` (if index-specific walkthrough used)

## Evidence capture template
- `E-HITL-BEFORE`: screenshot before mutation
- `E-HITL-ACTION`: request/response capture for action
- `E-HITL-AFTER`: screenshot after state update
- `E-HITL-AUDIT`: history/timeline proof screenshot

## Pass criteria
- Mutation action succeeds (2xx response).
- State transition visible in UI and reflected in API response.
- No runtime or auth failure during action.
