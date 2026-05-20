# Conservative Policy Profile
#
# Highly restrictive; requires strong justification for any action.
# TODO: Implement in Phase 2 of OPA rollout

package governance.conservative

default decision := "ALLOW"
default violatedGuardrails := []
default requiredApprovals := []
default confidence := 0.75

# Placeholder: conservative policy implementation coming in Phase 2
