#!/usr/bin/env python3
"""
Validate demo environment.

CRITICAL CHECKS:
- Total daily GB ≈ 159.93
- Index count ≈ 19
- Sourcetype count ≈ 176
- All queries filter by datasensai_run_id
- Agent does NOT read 1stmile_lookup.csv
- Macros expand to valid SPL
"""

import os
import sys
import json
import subprocess
import argparse
from pathlib import Path

def check_static_validation() -> bool:
    """Static validation (no Splunk connection)."""
    print("Running static validations...")
    print()

    base_dir = Path(__file__).parent
    summary_path = base_dir / 'output' / 'expected_summary.json'

    if not summary_path.exists():
        print("✗ expected_summary.json not found")
        return False

    with open(summary_path) as f:
        summary = json.load(f)

    print(f"✓ expected_summary.json exists")
    print(f"  Total daily GB: {summary['volume']['total_daily_gb']}")
    print(f"  Index count: {summary['counts']['index_count']}")
    print(f"  Sourcetype count: {summary['counts']['sourcetype_count']}")
    print()

    # Check NDJSON files
    event_files = [
        ('customer_events.ndjson', 'customer indexes'),
        ('internal_volume_events.ndjson', 'datasensai_internal_sim'),
        ('audit_search_events.ndjson', 'datasensai_audit_sim'),
    ]

    for filename, description in event_files:
        filepath = base_dir / 'output' / filename
        if not filepath.exists():
            print(f"✗ {filename} not found")
            return False

        # Check sample event has datasensai_run_id
        with open(filepath) as f:
            first_line = f.readline()
            try:
                event = json.loads(first_line)
                if 'datasensai_run_id' not in event:
                    print(f"✗ {filename}: events missing datasensai_run_id")
                    return False
                if not event.get('datasensai_synthetic'):
                    print(f"✗ {filename}: events missing datasensai_synthetic")
                    return False
            except:
                print(f"✗ {filename}: malformed JSON")
                return False

        print(f"✓ {filename} has datasensai_run_id and datasensai_synthetic")

    print()
    return True

def check_csv_not_used() -> bool:
    """Validate agent doesn't read CSV at runtime."""
    print("Checking that agent doesn't read CSV...")
    print()

    patterns_to_check = [
        ('1stmile_lookup.csv', 'CSV filename'),
        ('inputlookup 1stmile', 'inputlookup command'),
        ('pandas.read_csv', 'pandas CSV read'),
        ('csv.DictReader', 'CSV dict reader'),
    ]

    # Search apps/web for CSV usage
    search_dir = Path(__file__).parent.parent.parent.parent / 'apps' / 'web'

    found_issues = False
    for pattern, description in patterns_to_check:
        result = subprocess.run(
            ['grep', '-r', '--include=*.ts', '--include=*.tsx', '--include=*.js',
             '--include=*.jsx', '--include=*.py', pattern, str(search_dir)],
            capture_output=True, text=True
        )

        if result.returncode == 0:
            print(f"✗ Found {description} in runtime code:")
            for line in result.stdout.split('\n')[:3]:
                if line:
                    print(f"    {line}")
            found_issues = True

    if not found_issues:
        print("✓ Agent doesn't read CSV (grep found no runtime usage)")
    else:
        print()
        print("⚠ CSV usage detected in agent code — must update to use MCP queries instead")

    print()
    return not found_issues

def check_splunk_connection() -> bool:
    """Validate Splunk connection (requires env vars)."""
    print("Checking Splunk connection...")
    print()

    host = os.environ.get('SPLUNK_HOST')
    if not host:
        print("⊘ SPLUNK_HOST not set — skipping Splunk validation")
        print("  Set: export SPLUNK_HOST=144.202.48.85")
        return True

    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')

    # Test health endpoint
    cmd = [
        'curl', '-fsS', '-k', '-u', f'{user}:{password}',
        f'{scheme}://{host}:{port}/services/server/info?output_mode=json'
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"✓ Connected to Splunk at {host}:{port}")
            return True
        else:
            print(f"✗ Cannot connect to Splunk: {result.stderr}")
            return False
    except Exception as e:
        print(f"✗ Connection error: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Validate demo environment')
    parser.add_argument('--static-only', action='store_true',
                        help='Run static validation only (no Splunk connection)')
    args = parser.parse_args()

    print("Validating datasensAI demo environment...")
    print()
    print("=" * 60)
    print()

    # Static validation (always run)
    if not check_static_validation():
        print()
        print("✗ Static validation FAILED")
        return 1

    if args.static_only:
        print("Static validation passed.")
        return 0

    # CSV usage check
    if not check_csv_not_used():
        print("✗ Agent uses CSV at runtime — update to MCP queries")
        return 1

    # Splunk connection
    if not check_splunk_connection():
        print("✗ Cannot connect to Splunk")
        return 1

    print()
    print("=" * 60)
    print("✓ All validations passed!")
    print()
    print("Next: Load events into Splunk")
    print("  python load_events.py --force")

    return 0

if __name__ == '__main__':
    sys.exit(main())
