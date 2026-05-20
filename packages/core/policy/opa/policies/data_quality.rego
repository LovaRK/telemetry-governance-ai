# Data Quality Policy Profile
#
# Protects data integrity; resists optimization that could degrade quality.
# TODO: Implement in Phase 2 of OPA rollout

package governance.data_quality

default decision := "ALLOW"
default violatedGuardrails := []
default requiredApprovals := []
default confidence := 0.75

# Placeholder: data_quality policy implementation coming in Phase 2
