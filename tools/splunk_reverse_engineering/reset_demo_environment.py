#!/usr/bin/env python3
"""
Reset demo environment (safe cleanup).

CRITICAL GUARDRAILS:
- Dry-run by default (no destructive actions)
- Never delete _internal or _audit
- Never delete indexes not in customer allowlist
- Requires CONFIRM_RESET_DATASENSAI_DEMO=true to actually delete
- Only deletes indexes and app created by the demo script
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

def check_guardrails():
    """Enforce safety guardrails."""
    if not os.environ.get('SPLUNK_HOST'):
        print("ERROR: SPLUNK_HOST not set")
        sys.exit(1)

    print(f"✓ SPLUNK_HOST={os.environ.get('SPLUNK_HOST')}")

def delete_indexes_via_rest(indexes: list, dry_run: bool = False) -> int:
    """Delete indexes via REST API."""
    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    deleted = 0
    for index_name in indexes:
        # Guardrail: never delete system indexes
        if index_name in ['_internal', '_audit', '_audit_summary', '_thefishbucket']:
            print(f"  ✗ BLOCKED: Cannot delete {index_name} (system index)")
            continue

        url = f"{scheme}://{host}:{port}/services/data/indexes/{index_name}"

        cmd = ['curl', '-fsS', '-X', 'DELETE', '-u', f'{user}:{password}']
        if not verify:
            cmd.append('-k')
        cmd.append(url)

        if dry_run:
            print(f"  [DRY-RUN] DELETE {url}")
            deleted += 1
        else:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    print(f"  ✓ Deleted: {index_name}")
                    deleted += 1
                else:
                    print(f"  ✗ Error deleting {index_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

    return deleted

def main():
    parser = argparse.ArgumentParser(description='Reset demo environment')
    parser.add_argument('--dry-run', action='store_true', default=True,
                        help='Show what would be deleted (default: yes)')
    parser.add_argument('--force', action='store_true',
                        help='Actually delete (requires CONFIRM_RESET_DATASENSAI_DEMO=true)')
    args = parser.parse_args()

    dry_run = not args.force

    print("Reset datasensAI demo environment...")
    print()

    check_guardrails()
    print()

    # Demo indexes to delete
    demo_indexes = ['datasensai_internal_sim', 'datasensai_audit_sim']

    # Customer indexes from expected_summary.json (with dsdemo_ prefix)
    base_dir = Path(__file__).parent
    summary_path = base_dir / 'output' / 'expected_summary.json'

    customer_indexes = []
    if summary_path.exists():
        import json
        with open(summary_path) as f:
            summary = json.load(f)
            original_indexes = summary.get('all_indexes', [])
            # Apply dsdemo_ prefix for safety
            customer_indexes = [f"dsdemo_{idx.replace('-', '_').replace(' ', '_')}" for idx in original_indexes]

    all_indexes = demo_indexes + customer_indexes

    print(f"Indexes to delete: {len(all_indexes)}")
    print(f"  Demo: {demo_indexes}")
    print(f"  Customer: {len(customer_indexes)}")
    print()

    if dry_run:
        print("[DRY-RUN MODE] No indexes will be deleted.")
        print("Indexes that would be deleted:")
        for idx in all_indexes:
            print(f"  - {idx}")
        print()
        print("To actually delete, set CONFIRM_RESET_DATASENSAI_DEMO=true and run with --force:")
        print("  CONFIRM_RESET_DATASENSAI_DEMO=true python reset_demo_environment.py --force")
        return 0

    # Guardrail: require confirmation env var
    if not os.environ.get('CONFIRM_RESET_DATASENSAI_DEMO') == 'true':
        print("ERROR: CONFIRM_RESET_DATASENSAI_DEMO not set to 'true'")
        print("This is a safety check to prevent accidental deletion.")
        print("Set it with: export CONFIRM_RESET_DATASENSAI_DEMO=true")
        sys.exit(1)

    print(f"Deleting {len(all_indexes)} indexes...")
    print()

    deleted = delete_indexes_via_rest(all_indexes, dry_run=False)

    print()
    print(f"Deleted {deleted}/{len(all_indexes)} indexes")

    return 0

if __name__ == '__main__':
    sys.exit(main())
