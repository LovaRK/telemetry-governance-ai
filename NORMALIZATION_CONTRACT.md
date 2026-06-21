# Normalization Contract

**Status**: FROZEN (Phase 2A)  
**Effective Date**: 2026-05-28  
**Scope**: Governance system input normalization semantics

---

## Purpose

This document freezes normalization behavior for the governance system.

**Why?** Governance systems depend on deterministic normalization for:
- Replay validation (historical request + historical policy → same decision)
- Forensic reconstruction (identifying identical requests across time)
- Audit compliance (proving what was approved)

Silent normalization changes break these guarantees.

---

## Normalization Rules (Immutable)

### Rule 1: Protocol Normalization
**Input**: `https://example.com`, `HTTPS://EXAMPLE.COM`, `HTTP://example.com`  
**Output**: `https://example.com`, `https://example.com`, `http://example.com`

```
Protocol MUST be:
✅ Lowercase
❌ NOT: mixed case, uppercase
```

### Rule 2: Hostname Normalization
**Input**: `EXAMPLE.COM`, `example.com`, `ExAmple.CoM`  
**Output**: `example.com`, `example.com`, `example.com`

```
Hostname MUST be:
✅ Lowercase
✅ Lowercase all subdomains
❌ NOT: case variations
```

### Rule 3: Port Normalization
**Input**: `https://example.com:443`, `https://example.com`, `http://example.com:80`  
**Output**: `https://example.com`, `https://example.com`, `http://example.com`

```
Default ports MUST be omitted:
✅ https → 443 (implicit, omitted)
✅ http → 80 (implicit, omitted)
❌ NOT: included when default

Non-default ports MUST be included:
✅ https://example.com:8089 → https://example.com:8089
❌ NOT: omitted
```

### Rule 4: Trailing Slash Normalization
**Input**: `https://example.com/`, `https://example.com`, `https://example.com///`  
**Output**: `https://example.com`, `https://example.com`, `https://example.com`

```
Trailing slashes MUST be removed:
✅ https://example.com/ → https://example.com
✅ https://example.com/// → https://example.com
❌ NOT: preserved
```

### Rule 5: Whitespace Normalization
**Input**: `https://example.com ` (trailing space), `  https://example.com` (leading space)  
**Output**: `https://example.com`, `https://example.com`

```
Whitespace MUST be trimmed:
✅ Trim leading and trailing spaces
❌ NOT: preserved
```

### Rule 6: Query Parameter Handling
**Input**: `https://example.com?version=1`, `https://example.com?version=1&debug=true`, `https://example.com?debug=true&version=1`  
**Output**: `https://example.com?version=1`, `https://example.com?debug=true&version=1`, `https://example.com?debug=true&version=1`

```
Query parameters:
✅ Preserved as-is (not normalized away)
✅ Order matters (different order = different resource)
❌ NOT: reordered alphabetically
❌ NOT: removed
```

### Rule 7: URL Encoding
**Input**: `https://splunk-é.example.com`, `https://splunk-%C3%A9.example.com`  
**Output**: Both should normalize to the same canonical form

```
URL encoding:
✅ Percent-decoded: é (U+00E9)
✅ Then normalized using NFC (Normalization Form C)
✅ Then percent-encoded if needed
❌ NOT: mixed encodings
❌ NOT: different Unicode normalization forms
```

**Exception**: IRI (International Resource Identifiers) must be converted to ASCII URI.

### Rule 8: Path Normalization
**Input**: `https://example.com/path/../other`, `https://example.com/path/./other`, `https://example.com//path`  
**Output**: NOT NORMALIZED (preserved as-is)

```
Path components:
✅ Preserved as sent (.. and . not resolved)
✅ Double slashes not collapsed
❌ NOT: resolved
❌ NOT: collapsed

Rationale: Different paths may intentionally differ
```

---

## Forbidden Variations

These are explicitly NOT applied by normalization:

```
❌ Path resolution (.. and .)
❌ Port aliasing (port 8089 ≠ port 8090)
❌ IP resolution (127.0.0.1 ≠ localhost)
❌ Domain expansion (example.com ≠ www.example.com)
❌ Scheme expansion (http ≠ https)
❌ Default path injection (/ not added if omitted)
❌ Parameter reordering
❌ Fragment handling (#section not removed)
```

---

## Snapshot Test Cases

These MUST NOT CHANGE without explicit governance review.

### Test 1: Basic URL
```
Input:  "https://splunk.example.com:8089"
Output: "https://splunk.example.com:8089"
Fingerprint: input-[sha256-hash]
```

### Test 2: Trailing Slash
```
Input:  "https://splunk.example.com:8089/"
Output: "https://splunk.example.com:8089"
Fingerprint: input-[sha256-hash] (SAME as Test 1)
```

### Test 3: Case Variation
```
Input:  "HTTPS://SPLUNK.EXAMPLE.COM:8089"
Output: "https://splunk.example.com:8089"
Fingerprint: input-[sha256-hash] (SAME as Test 1)
```

### Test 4: Default Port (HTTPS)
```
Input:  "https://splunk.example.com:443"
Output: "https://splunk.example.com"
Fingerprint: input-[different-hash] (DIFFERENT - default port removed)
```

### Test 5: Non-Default Port
```
Input:  "https://splunk.example.com:8089"
Output: "https://splunk.example.com:8089"
Fingerprint: input-[sha256-hash]
```

### Test 6: Query Parameters Preserved
```
Input:  "https://splunk.example.com:8089?version=1"
Output: "https://splunk.example.com:8089?version=1"
Fingerprint: input-[sha256-hash]
```

### Test 7: Parameter Order Matters
```
Input-A: "https://example.com?a=1&b=2"
Input-B: "https://example.com?b=2&a=1"
Output-A: "https://example.com?a=1&b=2"
Output-B: "https://example.com?b=2&a=1"
Fingerprint-A: input-[hash-A] (DIFFERENT)
Fingerprint-B: input-[hash-B] (DIFFERENT)
```

### Test 8: Leading/Trailing Whitespace
```
Input:  "  https://splunk.example.com:8089  "
Output: "https://splunk.example.com:8089"
Fingerprint: input-[sha256-hash]
```

---

## Encoding Rules (Unicode & Percent)

### Unicode Normalization
```
Input:  "é" (U+00E9, LATIN SMALL LETTER E WITH ACUTE)
        OR "e" + "´" (U+0065 + U+0301, combining form)
Output: Both normalized to NFC form
Result: Same canonical form
```

### Percent Encoding
```
Input:  "%C3%A9" (UTF-8 encoded é)
Input:  "é" (direct Unicode)
Output: Both should be equivalent after normalization
Result: Same fingerprint
```

---

## Change Control

### How to Change Normalization
1. **Do NOT** change normalizeResource() without updating this contract
2. **Do NOT** change this contract without:
   - Snapshot tests updated
   - All existing governance decisions re-evaluated
   - Operator sign-off
   - Migration plan for historical data
3. **Document** the change as a new phase (e.g., "Phase 2A.1 Normalization v1.1")
4. **Version** the contract explicitly

### Versions
- **Phase 2A (2026-05-28)**: Normalization v1.0 (current)
- Future: Version increments for changes

---

## Implementation Snapshot Test

```typescript
// tests/integration/normalization-contract.test.ts

describe('Normalization Contract', () => {
  const testCases = [
    {
      name: 'Basic URL',
      input: 'https://splunk.example.com:8089',
      expectedOutput: 'https://splunk.example.com:8089',
      expectedFingerprint: 'input-abc123'
    },
    {
      name: 'Trailing Slash',
      input: 'https://splunk.example.com:8089/',
      expectedOutput: 'https://splunk.example.com:8089',
      expectedFingerprint: 'input-abc123' // SAME
    },
    {
      name: 'Case Variation',
      input: 'HTTPS://SPLUNK.EXAMPLE.COM:8089',
      expectedOutput: 'https://splunk.example.com:8089',
      expectedFingerprint: 'input-abc123' // SAME
    },
    // ... more test cases
  ];

  testCases.forEach(({ name, input, expectedOutput, expectedFingerprint }) => {
    it(`should normalize: ${name}`, () => {
      const normalized = normalizeResource(input);
      expect(normalized).toBe(expectedOutput);

      const fingerprint = generateInputFingerprint({ resource: normalized });
      expect(fingerprint).toBe(expectedFingerprint);
    });
  });
});
```

---

## Compliance Notes

### For Governance Forensics
- **Replay**: Use input_fingerprint to identify historical requests
- **Migration**: Any normalization change requires governance re-evaluation
- **Audit**: Document normalization version in decision metadata

### For Future Phases
- **Phase 2B**: Approval system depends on input_fingerprint stability
- **Phase 2C**: Resource scopes depend on normalization consistency
- **Compliance**: Audit trail depends on normalization being frozen

---

## What To Do If Normalization Changes Are Needed

1. **Analyze Impact**
   - How many historical decisions affected?
   - Are they still valid?
   - Do they need re-evaluation?

2. **Create Migration Plan**
   - Version the new normalization
   - Create mapping (old fingerprint → new fingerprint)
   - Re-evaluate decisions under new normalization

3. **Update This Contract**
   - Document the change
   - Update snapshot tests
   - Update implementation version

4. **Audit Compliance**
   - Ensure replay validation still works
   - Verify historical decisions can be mapped
   - Document for compliance

5. **Operator Sign-Off**
   - Get approval before deploying
   - Document decision in governance ledger

---

## Critical: Library Upgrade Implications

### URL Parsing Library Changes
If normalizeResource() uses a library (e.g., Node.js `URL` class), **library updates may silently change behavior**:

Example:
```
Node.js v16.0.0: URL('https://example.com:443').href = 'https://example.com/'
Node.js v18.0.0: URL('https://example.com:443').href = 'https://example.com:443/'
```

**Action**: 
- Pin library versions
- Test normalization on library upgrades
- Don't auto-upgrade without governance review

### Unicode Normalization Library
If using external Unicode library, same risk applies.

**Action**:
- Pin library versions
- Snapshot test on upgrades
- Document baseline behavior

---

## Summary

Normalization is now a **governance contract**, not implementation detail.

- ✅ Frozen (no silent changes)
- ✅ Documented (canonical examples)
- ✅ Tested (snapshot tests)
- ✅ Versioned (Phase 2A v1.0)
- ✅ Controlled (change requires approval)

This enables:
- **Replay validation** (historical request → same decision)
- **Forensic reconstruction** (identify identical requests)
- **Compliance audits** (prove what was approved)

Replayability depends on this contract.
