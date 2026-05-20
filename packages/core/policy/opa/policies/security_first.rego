# Security-First Policy Profile
#
# Prioritizes data security and detection integrity.
# Prevents elimination of high-detection indexes unless explicitly approved.

package governance.security_first

default decision := "ALLOW"
default violatedGuardrails := []
default requiredApprovals := []
default confidence := 0.85

# Critical detection threshold: 80+ indicates active threat monitoring
critical_detection if {
  input.scores.detection >= 80
}

# Medium detection threshold: 40-80 indicates ongoing monitoring value
medium_detection if {
  input.scores.detection >= 40
  input.scores.detection < 80
}

# Deny: Cannot eliminate critical detection indexes
deny_eliminate_critical_detection if {
  input.proposedAction == "ELIMINATE"
  critical_detection
}

# Deny: Cannot optimize away critical detection
deny_optimize_critical_detection if {
  input.proposedAction == "OPTIMIZE"
  critical_detection
  input.scores.utilization < 20  # Low utilization + high detection = suspicious
}

# Apply deny rules
decision := "DENY" if {
  deny_eliminate_critical_detection
}

decision := "DENY" if {
  deny_optimize_critical_detection
}

# Gather violated guardrails
violatedGuardrails := ["SECURITY_DETECTION_PROTECTED"] if {
  deny_eliminate_critical_detection
}

violatedGuardrails := ["SECURITY_LOW_UTILIZATION_DETECTION_MISMATCH"] if {
  deny_optimize_critical_detection
}

# Require approval: Medium detection with cost savings requires security sign-off
decision := "REQUIRE_APPROVAL" if {
  input.proposedAction == "ELIMINATE"
  medium_detection
  input.economics.estimatedSavingsUsd >= 5000
  not deny_eliminate_critical_detection
}

requiredApprovals := ["SECURITY_LEAD", "CISO"] if {
  decision == "REQUIRE_APPROVAL"
  medium_detection
}

# Require approval: Large cost changes require approval
decision := "REQUIRE_APPROVAL" if {
  input.economics.estimatedSavingsUsd >= 50000
  not deny_eliminate_critical_detection
  not deny_optimize_critical_detection
}

requiredApprovals := ["FINOPS_LEAD", "PROCUREMENT"] if {
  decision == "REQUIRE_APPROVAL"
  input.economics.estimatedSavingsUsd >= 50000
}

# Confidence based on detection clarity
confidence := 0.95 if {
  critical_detection
}

confidence := 0.75 if {
  medium_detection
}

confidence := 0.60 if {
  not critical_detection
  not medium_detection
}
