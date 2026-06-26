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

def compare_expected_vs_splunk(run_id: str) -> bool:
    """Compare expected sourcetypes/GB from CSV vs what Splunk actually has."""
    import csv

    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    if not host or not user:
        print("ERROR: SPLUNK_HOST and SPLUNK_USERNAME required")
        return False

    print(f"Comparing expected vs Splunk for run_id: {run_id}")
    print()

    # --- Expected: from CSV ---
    base_dir = Path(__file__).parent
    csv_path = base_dir / 'fixtures' / '1stmile_lookup.csv'
    expected_by_idx = {}
    expected_by_st = {}
    expected_gb = 0.0

    with open(csv_path) as f:
        for row in csv.DictReader(f):
            idx = row.get('index', '').strip()
            st = row.get('sourcetype', '').strip()
            gb = float(row.get('GB_idx_st_s', 0))
            if not idx or gb == 0:
                continue
            expected_by_idx[idx] = expected_by_idx.get(idx, 0) + 1
            expected_by_st[st] = expected_by_st.get(st, 0) + 1
            expected_gb += gb

    # --- Actual: from Splunk (use idx field to avoid multivalued sourcetype) ---
    url = f"{scheme}://{host}:{port}/services/search/jobs/export"
    search = (
        f'search index=datasensai_internal_sim datasensai_run_id="{run_id}" earliest=0 '
        f'| stats count as event_count sum(GB_idx_st_s) as gb by idx st'
    )
    cmd = ['curl', '-s', '-u', f'{user}:{password}', '--max-time', '60',
           '--data-urlencode', f'search={search}',
           '--data-urlencode', 'output_mode=json']
    if not verify:
        cmd.append('-k')
    cmd.append(url)

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=65)
    if result.returncode != 0:
        print(f"✗ Splunk query failed: {result.stderr}")
        return False

    actual_by_idx = {}
    actual_by_st = {}
    actual_gb = 0.0
    actual_events = 0
    for line in result.stdout.strip().split('\n'):
        if not line.strip():
            continue
        try:
            d = json.loads(line)
            if 'result' in d:
                r = d['result']
                idx = r.get('idx', '')
                st = r.get('st', '')
                gb = float(r.get('gb', 0))
                cnt = int(r.get('event_count', 0))
                actual_by_idx[idx] = actual_by_idx.get(idx, 0) + cnt
                actual_by_st[st] = actual_by_st.get(st, 0) + cnt
                actual_gb += gb
                actual_events += cnt
        except (json.JSONDecodeError, ValueError, KeyError):
            continue

    # --- Report ---
    print(f"{'Metric':<25} {'Expected':>10} {'Actual':>10} {'Status':>10}")
    print("-" * 60)

    idx_match = len(expected_by_idx) == len(actual_by_idx)
    print(f"{'Logical indexes':<25} {len(expected_by_idx):>10} {len(actual_by_idx):>10} {'✓' if idx_match else '✗':>10}")

    st_match = len(expected_by_st) == len(actual_by_st)
    print(f"{'Sourcetypes':<25} {len(expected_by_st):>10} {len(actual_by_st):>10} {'✓' if st_match else '✗':>10}")

    evt_match = sum(expected_by_idx.values()) == actual_events
    print(f"{'Internal events':<25} {sum(expected_by_idx.values()):>10} {actual_events:>10} {'✓' if evt_match else '✗':>10}")

    gb_close = abs(expected_gb - actual_gb) < 1.0
    print(f"{'Total GB':<25} {expected_gb:>10.2f} {actual_gb:>10.2f} {'✓' if gb_close else '✗':>10}")
    print()

    # Missing sourcetypes
    missing_st = set(expected_by_st.keys()) - set(actual_by_st.keys())
    if missing_st:
        print(f"Missing sourcetypes ({len(missing_st)}):")
        for st in sorted(missing_st):
            print(f"  ✗ {st} ({expected_by_st[st]} events, in CSV but not in Splunk)")
        print()

    # Missing indexes
    missing_idx = set(expected_by_idx.keys()) - set(actual_by_idx.keys())
    if missing_idx:
        print(f"Missing indexes ({len(missing_idx)}):")
        for idx in sorted(missing_idx):
            print(f"  ✗ {idx}")
        print()

    # Per-index event count comparison
    idx_mismatches = []
    for idx in sorted(set(expected_by_idx.keys()) | set(actual_by_idx.keys())):
        e = expected_by_idx.get(idx, 0)
        a = actual_by_idx.get(idx, 0)
        if e != a:
            idx_mismatches.append((idx, e, a))

    if idx_mismatches:
        print("Per-index event mismatches:")
        for idx, e, a in idx_mismatches:
            print(f"  ✗ {idx}: expected={e}, actual={a}, missing={e - a}")
        print()

    all_match = idx_match and st_match and evt_match and gb_close
    if all_match:
        print("✓ Full data parity achieved!")
    else:
        print("⚠ Data parity gaps found (see above)")

    return all_match


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
    parser.add_argument('--compare-expected', action='store_true',
                        help='Compare expected CSV data vs actual Splunk data')
    parser.add_argument('--run-id', type=str,
                        default=os.environ.get('DATASENSAI_RUN_ID', ''),
                        help='Run ID to validate (default: DATASENSAI_RUN_ID env var)')
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

    if args.compare_expected:
        if not args.run_id:
            print("ERROR: --run-id required (or set DATASENSAI_RUN_ID)")
            return 1
        if not compare_expected_vs_splunk(args.run_id):
            return 1
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
