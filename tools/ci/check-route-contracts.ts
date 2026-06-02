/**
 * CI check: every Next.js API route must have at least one entry in ALL_CONTRACTS.
 *
 * - Crawls apps/web/app/api for route.ts files
 * - Derives the canonical route path (Next.js [param] → :param)
 * - Fails with exit code 1 listing any paths absent from ALL_CONTRACTS
 *
 * Usage: ts-node tools/ci/check-route-contracts.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Resolve paths relative to repo root (two levels up from tools/ci/)
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_DIR   = path.join(REPO_ROOT, 'apps', 'web', 'app', 'api');
const CONTRACTS_FILE = path.join(
  REPO_ROOT, 'apps', 'api', 'middleware', 'route-contracts.ts'
);

// ─── Collect Next.js route paths ────────────────────────────────────────────

function collectRoutePaths(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRoutePaths(full, base));
    } else if (entry.name === 'route.ts') {
      // Strip the base dir prefix + '/route.ts' suffix to get the path segment
      const rel = path.dirname(path.relative(base, full)); // e.g. "auth/login"
      // Convert filesystem path separators to URL slashes
      const urlPath = '/api/' + rel.split(path.sep).join('/');
      // Convert Next.js dynamic segments [param] → :param
      const canonical = urlPath.replace(/\[([^\]]+)\]/g, ':$1');
      results.push(canonical);
    }
  }
  return results;
}

// ─── Extract contract paths from route-contracts.ts ─────────────────────────
// Parse statically: read source and extract all `path: '...'` string literals
// from ALL_CONTRACTS. This avoids importing the file (which may have deps).

function extractContractPaths(filePath: string): Set<string> {
  const src = fs.readFileSync(filePath, 'utf8');
  // Match: path: '/api/...' or path: "/api/..."
  const matches = src.matchAll(/\bpath:\s*['"]([^'"]+)['"]/g);
  const paths = new Set<string>();
  for (const m of matches) {
    paths.add(m[1]);
  }
  return paths;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  if (!fs.existsSync(API_DIR)) {
    console.error(`[check-route-contracts] ERROR: API directory not found: ${API_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(CONTRACTS_FILE)) {
    console.error(`[check-route-contracts] ERROR: Contracts file not found: ${CONTRACTS_FILE}`);
    process.exit(1);
  }

  const routePaths    = collectRoutePaths(API_DIR).sort();
  const contractPaths = extractContractPaths(CONTRACTS_FILE);

  const missing = routePaths.filter(p => !contractPaths.has(p));

  if (missing.length === 0) {
    console.log(`[check-route-contracts] OK — all ${routePaths.length} routes have contracts.`);
    process.exit(0);
  }

  console.error('[check-route-contracts] FAIL — the following routes have no contract entry:');
  for (const p of missing) {
    console.error(`  MISSING: ${p}`);
  }
  console.error('');
  console.error(
    `Add an entry to apps/api/middleware/route-contracts.ts (ALL_CONTRACTS) for each route above.`
  );
  process.exit(1);
}

main();
