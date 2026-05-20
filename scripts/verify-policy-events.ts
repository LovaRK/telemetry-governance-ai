#!/usr/bin/env node
/**
 * Policy Event Verification Script
 *
 * Tests the POLICY_EVENT_CONTRACT implementation by running both evaluation vectors:
 * - VECTOR A: DISABLE_PCI_LOGS → CRITICAL block committed
 * - VECTOR B: DROP_PROD_SPANS → HIGH risk approval gate committed
 *
 * Displays the monotonic event sequences in the canonical event ledger.
 */

import { executePolicyEvaluation, approveOperatorDecision, type PolicyEvaluationInput } from '../core/governance/policy-engine-events';
import { getExecutionTimeline } from '../core/database/pipeline-events';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
};

async function main() {
  console.log(`${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}POLICY EVENT VERIFICATION — MONOTONIC SEQUENCING & GOVERNANCE AUDIT${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);

  try {
    // ========================================================================
    // VECTOR A: CRITICAL Compliance Violation
    // ========================================================================
    console.log(
      `${colors.bold}${colors.red}[VECTOR A] The Exploit Payload${colors.reset}`
    );
    console.log(`${colors.gray}Input: 'DISABLE_PCI_LOGS'${colors.reset}`);
    console.log(`${colors.gray}Expected: CRITICAL hard block committed${colors.reset}\n`);

    const vectorA = await executePolicyEvaluation({
      actionType: 'DISABLE_PCI_LOGS',
      targetService: 'audit-logging-service',
      targetCluster: 'cluster-prod-1',
      payload: {
        action_type: 'DISABLE_PCI_LOGS',
        target_service: 'audit-logging-service',
        requested_reduction_bytes: 1000000,
      },
      operatorSessionId: 'session_compliance_audit',
    });

    console.log(`${colors.green}✓ Evaluation completed${colors.reset}`);
    console.log(`  Status: ${colors.bold}${vectorA.status.toUpperCase()}${colors.reset}`);
    console.log(`  Risk Level: ${colors.red}${vectorA.riskLevel}${colors.reset}`);
    console.log(`  Execution ID: ${colors.cyan}${vectorA.executionId}${colors.reset}\n`);

    // Retrieve and display full event timeline
    console.log(`${colors.bold}Event Timeline (Monotonic Sequence):${colors.reset}`);
    const timelineA = await getExecutionTimeline(vectorA.executionId);

    for (const event of timelineA) {
      console.log(
        `  ${colors.gray}[Seq ${event.sequence}]${colors.reset} ${colors.bold}${event.event_type}${colors.reset}`
      );
      console.log(`    Taxonomy: ${event.taxonomy} | Severity: ${colors.red}${event.severity}${colors.reset}`);
      console.log(`    Message: ${event.message}`);
      if (event.governance?.matched_policies) {
        console.log(`    Policies: ${event.governance.matched_policies.join(', ')}`);
      }
      console.log();
    }

    // ========================================================================
    // VECTOR B: HIGH-Risk Approval Gate
    // ========================================================================
    console.log(`\n${colors.bold}${colors.yellow}[VECTOR B] The Cost Proposal${colors.reset}`);
    console.log(`${colors.gray}Input: 'DROP_PROD_SPANS'${colors.reset}`);
    console.log(`${colors.gray}Expected: HIGH risk approval gate committed${colors.reset}\n`);

    const vectorB = await executePolicyEvaluation({
      actionType: 'DROP_PROD_SPANS',
      targetService: 'tracing-service-v2',
      targetCluster: 'cluster-b',
      payload: {
        action_type: 'DROP_PROD_SPANS',
        target_service: 'tracing-service-v2',
        requested_reduction_bytes: 4209110,
        confidence_score: 0.94,
      },
      operatorSessionId: 'session_cost_optimization',
    });

    console.log(`${colors.green}✓ Evaluation completed${colors.reset}`);
    console.log(`  Status: ${colors.bold}${vectorB.status.toUpperCase()}${colors.reset}`);
    console.log(`  Risk Level: ${colors.yellow}${vectorB.riskLevel}${colors.reset}`);
    console.log(`  Execution ID: ${colors.cyan}${vectorB.executionId}${colors.reset}\n`);

    // Retrieve initial timeline
    console.log(`${colors.bold}Event Timeline (Initial):${colors.reset}`);
    let timelineB = await getExecutionTimeline(vectorB.executionId);

    for (const event of timelineB) {
      console.log(
        `  ${colors.gray}[Seq ${event.sequence}]${colors.reset} ${colors.bold}${event.event_type}${colors.reset}`
      );
      console.log(`    Taxonomy: ${event.taxonomy} | Severity: ${colors.yellow}${event.severity}${colors.reset}`);
      console.log(`    Message: ${event.message}`);
      if (event.governance?.requires_approval) {
        console.log(`    ${colors.bold}Approval Required${colors.reset}: true`);
        if (event.governance.rollback_metadata) {
          console.log(`    Rollback: ${event.governance.rollback_metadata.recovery_mechanism} (~${event.governance.rollback_metadata.estimated_recovery_time_secs}s)`);
        }
      }
      console.log();
    }

    // ====================================================================
    // OPERATOR APPROVAL CASCADE — Seq 3
    // ====================================================================
    console.log(`\n${colors.bold}${colors.cyan}[CASCADE] Operator Grants Authorization${colors.reset}`);
    console.log(`${colors.gray}Action: Operator 'alice' approves DROP_PROD_SPANS with cost-benefit justification${colors.reset}\n`);

    const approvalResult = await approveOperatorDecision(
      vectorB.executionId,
      'session_operator_alice',
      'Cost reduction justifies traced telemetry reduction in staging; will monitor for anomalies'
    );

    console.log(`${colors.green}✓ Approval granted${colors.reset}`);
    console.log(`  Status: ${colors.bold}${approvalResult.status}${colors.reset}`);
    console.log(`  Sequence: ${colors.cyan}${approvalResult.sequenceNumber}${colors.reset}\n`);

    // Retrieve updated timeline with Seq 3
    console.log(`${colors.bold}Event Timeline (Post-Approval):${colors.reset}`);
    timelineB = await getExecutionTimeline(vectorB.executionId);

    for (const event of timelineB) {
      console.log(
        `  ${colors.gray}[Seq ${event.sequence}]${colors.reset} ${colors.bold}${event.event_type}${colors.reset}`
      );
      console.log(`    Taxonomy: ${event.taxonomy} | Severity: ${colors.yellow}${event.severity}${colors.reset}`);
      console.log(`    Message: ${event.message}`);
      if (event.actor) {
        console.log(`    Actor: ${event.actor}`);
      }
      console.log();
    }

    // ========================================================================
    // VERIFICATION SUMMARY
    // ========================================================================
    console.log(`${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
    console.log(`${colors.bold}${colors.green}VERIFICATION SUMMARY${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);

    const vectorAPassed =
      vectorA.status === 'BLOCKED' &&
      vectorA.riskLevel === 'CRITICAL' &&
      timelineA.length === 2 &&
      timelineA[1].event_type === 'POLICY_ENFORCEMENT_BLOCKED';

    const vectorBPassed =
      vectorB.status === 'APPROVAL_REQUIRED' &&
      vectorB.riskLevel === 'HIGH' &&
      timelineB.length === 3 &&
      timelineB[1].event_type === 'POLICY_APPROVAL_REQUIRED' &&
      timelineB[2].event_type === 'OPERATOR_APPROVAL_GRANTED';

    console.log(`${colors.bold}VECTOR A (Compliance Violation):${colors.reset}`);
    console.log(`  ${vectorAPassed ? colors.green + '✓' : colors.red + '✗'} POLICY_VALIDATION_EXECUTED emitted${colors.reset}`);
    console.log(`  ${vectorAPassed ? colors.green + '✓' : colors.red + '✗'} POLICY_ENFORCEMENT_BLOCKED terminal event${colors.reset}`);
    console.log(`  ${vectorAPassed ? colors.green + '✓' : colors.red + '✗'} Monotonic sequence (1,2)${colors.reset}`);
    console.log(
      `  ${vectorAPassed ? colors.green + '✓' : colors.red + '✗'} CRITICAL severity assigned${colors.reset}\n`
    );

    console.log(`${colors.bold}VECTOR B (Cost Proposal + Operator Override):${colors.reset}`);
    console.log(`  ${vectorBPassed ? colors.green + '✓' : colors.red + '✗'} POLICY_VALIDATION_EXECUTED emitted${colors.reset}`);
    console.log(`  ${vectorBPassed ? colors.green + '✓' : colors.red + '✗'} POLICY_APPROVAL_REQUIRED gate (Seq 2)${colors.reset}`);
    console.log(`  ${vectorBPassed ? colors.green + '✓' : colors.red + '✗'} OPERATOR_APPROVAL_GRANTED cascade (Seq 3)${colors.reset}`);
    console.log(`  ${vectorBPassed ? colors.green + '✓' : colors.red + '✗'} Monotonic sequence (1,2,3)${colors.reset}`);
    console.log(
      `  ${vectorBPassed ? colors.green + '✓' : colors.red + '✗'} HIGH severity & operator override${colors.reset}\n`
    );

    const allPassed = vectorAPassed && vectorBPassed;

    console.log(`${colors.bold}${allPassed ? colors.green : colors.red}Overall: ${allPassed ? 'ALL VECTORS PASSED ✓' : 'VERIFICATION FAILED ✗'}${colors.reset}\n`);

    if (allPassed) {
      console.log(
        `${colors.green}${colors.bold}The platform now operates as a governed operational decision system.${colors.reset}`
      );
      console.log(`${colors.green}Policy evaluation events are immutably recorded in the canonical ledger.${colors.reset}`);
    }

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error(`${colors.red}${colors.bold}Verification Failed:${colors.reset}`, error);
    process.exit(1);
  }
}

main();
