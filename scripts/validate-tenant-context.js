#!/usr/bin/env node
/**
 * CI Gate: Validate tenant context enforcement
 *
 * CRITICAL: This script prevents the 'default' fallback pattern from reappearing.
 * Runs as a pre-commit hook or build step. Fails build if dangerous patterns found.
 *
 * Dangerous patterns:
 * - tenantId || 'default'   (silent fallback)
 * - tenant_id ?? 'default'  (nullish coalescing fallback)
 * - = 'default'             (literal default assignment)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PATTERNS_TO_REJECT = [
  {
    name: 'Fallback to default via ||',
    regex: /tenantId\s*\|\|\s*['"]default['"]/g,
    example: "❌ const tenantId = request.headers.get('x-tenant-id') || 'default';",
  },
  {
    name: 'Fallback to default via ??',
    regex: /tenant_id\s*\?\?\s*['"]default['"]/g,
    example: "❌ const tenantId = tenant_id ?? 'default';",
  },
  {
    name: 'Literal default assignment',
    regex: /=\s*['"]default['"].*tenantId|tenantId.*=\s*['"]default['"]/g,
    example: "❌ const tenantId = 'default';",
  },
  {
    name: 'Fallback via OR in headers',
    regex: /headers\.get\(['"].*tenant.*['"]\)\s*\|\|\s*['"]default['"]/g,
    example: "❌ const tenantId = request.headers.get('x-tenant-id') || 'default';",
  },
];

const SAFE_FILES = [
  'node_modules',
  '.next',
  'dist',
  '.git',
  '.env',
  'package-lock.json',
];

function scanDirectory(dir) {
  const violations = [];

  function walk(currentPath) {
    const files = fs.readdirSync(currentPath);

    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stat = fs.statSync(filePath);

      if (SAFE_FILES.some(safe => filePath.includes(safe))) {
        continue;
      }

      if (stat.isDirectory()) {
        walk(filePath);
      } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
        const content = fs.readFileSync(filePath, 'utf8');

        for (const pattern of PATTERNS_TO_REJECT) {
          const matches = content.match(pattern.regex);
          if (matches) {
            violations.push({
              file: filePath,
              pattern: pattern.name,
              example: pattern.example,
              matches: matches.length,
              lineNumber: content.substring(0, content.indexOf(matches[0])).split('\n').length,
            });
          }
        }
      }
    }
  }

  walk(dir);
  return violations;
}

function main() {
  const appsDir = path.join(__dirname, '..', 'apps');

  console.log('[TenantContext CI Gate] Scanning codebase for dangerous patterns...\n');

  const violations = scanDirectory(appsDir);

  if (violations.length === 0) {
    console.log('✅ PASS: No dangerous tenant context patterns found.');
    console.log('   All routes use requireContext() with fail-closed pattern.\n');
    process.exit(0);
  }

  console.error('❌ FAIL: Found dangerous tenant context patterns:\n');

  const groupedByFile = {};
  for (const violation of violations) {
    if (!groupedByFile[violation.file]) {
      groupedByFile[violation.file] = [];
    }
    groupedByFile[violation.file].push(violation);
  }

  for (const [file, fileViolations] of Object.entries(groupedByFile)) {
    console.error(`   ${file}`);
    for (const v of fileViolations) {
      console.error(`   ├─ Line ${v.lineNumber}: ${v.pattern} (${v.matches} match)`);
      console.error(`   │  ${v.example}`);
    }
    console.error('');
  }

  console.error('CONTEXT: Dangerous patterns allow silent fallback to "default" tenant,');
  console.error('         contaminating databases and violating tenant isolation.\n');
  console.error('FIX:     Use requireContext() and extract tenantId from RequestContext.\n');
  console.error('PATTERN: const ctxOrError = await requireContext(request);');
  console.error('         if (ctxOrError instanceof NextResponse) return ctxOrError;');
  console.error('         const tenantId = ctxOrError.tenantId;\n');

  process.exit(1);
}

main();
