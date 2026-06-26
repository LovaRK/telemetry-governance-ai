#!/usr/bin/env python3
"""
Create Splunk indexes for the demo environment.

CRITICAL GUARDRAILS:
- DATASENSAI_MODE=demo only: Creates datasensai_internal_sim and datasensai_audit_sim
- DATASENSAI_MODE=production: Refuses to create synthetic indexes
- Never touches _internal or _audit
- Never creates indexes not in the customer allowlist from CSV
- Requires SPLUNK_* env vars
- Supports --dry-run (default) and --force
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from typing import List, Dict, Set
import argparse

def get_customer_indexes() -> Set[str]:
    """Read customer indexes from expected_summary.json."""
    base_dir = Path(__file__).parent
    summary_path = base_dir / 'output' / 'expected_summary.json'

    if not summary_path.exists():
        print("ERROR: expected_summary.json not found")
        print("Run: python reverse_engineer_1stmile.py")
        sys.exit(1)

    with open(summary_path) as f:
        summary = json.load(f)

    return set(summary.get('all_indexes', []))

def check_guardrails() -> None:
    """Enforce production safety guardrails."""
    mode = os.environ.get('DATASENSAI_MODE', 'demo')

    if mode not in ['demo', 'production']:
        print(f"ERROR: DATASENSAI_MODE must be 'demo' or 'production', got '{mode}'")
        sys.exit(1)

    if mode == 'production':
        print("ERROR: DATASENSAI_MODE=production — refusing to create synthetic indexes")
        print("This script only creates demo indexes. Use Splunk's native config for production.")
        sys.exit(1)

    # Check required env vars
    for var in ['SPLUNK_HOST', 'SPLUNK_PORT', 'SPLUNK_USERNAME']:
        if not os.environ.get(var):
            print(f"ERROR: {var} not set")
            sys.exit(1)

    print(f"✓ DATASENSAI_MODE={mode} — creating demo indexes")
    print(f"✓ SPLUNK_HOST={os.environ.get('SPLUNK_HOST')}")

def create_index_via_rest(index_name: str, dry_run: bool = False) -> bool:
    """Create a Splunk index via REST API."""
    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    url = f"{scheme}://{host}:{port}/services/data/indexes"

    cmd = [
        'curl', '-fsS', '-u', f'{user}:{password}',
        '-d', f'name={index_name}&datatype=event',
    ]

    if not verify:
        cmd.append('-k')  # Skip SSL verification

    if dry_run:
        print(f"  [DRY-RUN] POST {url} with name={index_name}")
        return True

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"  ✓ Created index: {index_name}")
            return True
        else:
            # Index may already exist — that's OK
            if 'already exists' in result.stderr or 'already exists' in result.stdout:
                print(f"  ✓ Index already exists: {index_name}")
                return True
            print(f"  ⚠ Warning creating {index_name}: {result.stderr}")
            return False
    except Exception as e:
        print(f"  ✗ Error creating {index_name}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Create Splunk demo indexes')
    parser.add_argument('--dry-run', action='store_true', default=True,
                        help='Show what would be created (default: yes)')
    parser.add_argument('--force', action='store_true',
                        help='Actually create indexes (requires --force)')
    args = parser.parse_args()

    dry_run = not args.force

    print("Creating Splunk demo indexes...")
    print()

    # Guardrails
    check_guardrails()
    print()

    # Get customer indexes
    customer_indexes = get_customer_indexes()
    print(f"Customer indexes from CSV: {len(customer_indexes)}")
    print()

    # Demo indexes
    demo_indexes = ['datasensai_internal_sim', 'datasensai_audit_sim']
    all_indexes = demo_indexes + sorted(list(customer_indexes))

    if dry_run:
        print("[DRY-RUN MODE] No indexes will be created.")
        print("To actually create indexes, run with --force")
        print()

    print(f"Creating {len(all_indexes)} indexes:")
    print()

    success_count = 0
    for index_name in all_indexes:
        # Guardrail: never create _internal or _audit
        if index_name in ['_internal', '_audit']:
            print(f"  ✗ BLOCKED: Cannot create {index_name} (system index)")
            continue

        if create_index_via_rest(index_name, dry_run):
            success_count += 1

    print()
    if dry_run:
        print("[DRY-RUN] Summary:")
        print(f"  Would create {len(all_indexes)} indexes")
        print(f"  Demo indexes: {demo_indexes}")
        print(f"  Customer indexes: {len(customer_indexes)}")
        print()
        print("To actually create, run:")
        print("  python create_indexes.py --force")
    else:
        print(f"Created {success_count}/{len(all_indexes)} indexes")

    return 0

if __name__ == '__main__':
    sys.exit(main())
