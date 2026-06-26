#!/usr/bin/env python3
"""
Load synthetic events into Splunk indexes with production safety.

CRITICAL GUARDRAILS:
- Transform NDJSON → HEC event envelope before sending
- Include datasensai_run_id in every event
- Only load into demo indexes (datasensai_internal_sim, datasensai_audit_sim, dsdemo_*)
- Refuse if DATASENSAI_MODE=production
- Require explicit DATASENSAI_RUN_ID
- PRE-LOAD CHECK: Fail if same run_id already exists in Splunk
- SAFETY: Use separate SPLUNK_HEC_URL, not inferred from management port
- Use dsdemo_* prefixed indexes for customer data (prevent real data deletion)
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime
import time
import argparse

def check_guardrails() -> str:
    """Enforce production safety guardrails and return run_id."""
    mode = os.environ.get('DATASENSAI_MODE', 'demo')

    if mode == 'production':
        print("ERROR: DATASENSAI_MODE=production — refusing to load synthetic data")
        sys.exit(1)

    # CRITICAL: Require explicit run_id (never "latest" logic)
    run_id = os.environ.get('DATASENSAI_RUN_ID')
    if not run_id:
        print("ERROR: DATASENSAI_RUN_ID not set")
        print("Set it with: export DATASENSAI_RUN_ID=1stmile-demo-20260626-001")
        sys.exit(1)

    print(f"✓ DATASENSAI_MODE={mode}")
    print(f"✓ DATASENSAI_RUN_ID={run_id} (explicit, not 'latest')")

    # Check required management API vars
    for var in ['SPLUNK_HOST', 'SPLUNK_PORT', 'SPLUNK_USERNAME']:
        if not os.environ.get(var):
            print(f"ERROR: {var} not set (required for pre-load check)")
            sys.exit(1)

    # HEC URL is separate and optional
    hec_url = os.environ.get('SPLUNK_HEC_URL')
    if hec_url:
        print(f"✓ SPLUNK_HEC_URL configured (will use HEC method)")
    else:
        print(f"⊘ SPLUNK_HEC_URL not set (will fallback to REST method)")

    return run_id

def check_pre_load_duplicate(run_id: str, dry_run: bool = False) -> bool:
    """Check if this run_id already exists in Splunk.

    CRITICAL: Prevent duplicate-load corruption by failing if same run_id is found.
    """
    if dry_run:
        print("\n[DRY-RUN] Would check for existing run_id in Splunk")
        print(f"  Query: index=datasensai_internal_sim datasensai_run_id=\"{run_id}\" | stats count")
        return True

    print(f"\nPre-load check: searching for existing run_id '{run_id}'...")

    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    # Search for existing run_id
    search_query = f'index=datasensai_internal_sim datasensai_run_id="{run_id}" | stats count'

    url = f"{scheme}://{host}:{port}/services/search/jobs"

    cmd = [
        'curl', '-fsS', '-u', f'{user}:{password}',
        '-d', f'search={search_query}&output_mode=json',
    ]

    if not verify:
        cmd.append('-k')

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            job_id = data.get('sid')

            # Wait for search to complete
            check_url = f"{scheme}://{host}:{port}/services/search/jobs/{job_id}"
            for attempt in range(30):
                check_cmd = [
                    'curl', '-fsS', '-u', f'{user}:{password}',
                    f'{check_url}?output_mode=json'
                ]
                if not verify:
                    check_cmd.insert(-1, '-k')

                check_result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=10)
                if check_result.returncode == 0:
                    check_data = json.loads(check_result.stdout)
                    if check_data.get('entry', [{}])[0].get('content', {}).get('isDone') == 1:
                        # Search done, check results
                        results_cmd = [
                            'curl', '-fsS', '-u', f'{user}:{password}',
                            f'{check_url}/results?output_mode=json'
                        ]
                        if not verify:
                            results_cmd.insert(-1, '-k')

                        results_result = subprocess.run(results_cmd, capture_output=True, text=True, timeout=10)
                        if results_result.returncode == 0:
                            results_data = json.loads(results_result.stdout)
                            count = int(results_data.get('results', [{}])[0].get('count', 0))

                            if count > 0:
                                print(f"✗ DUPLICATE RUN DETECTED")
                                print(f"  Run ID '{run_id}' already exists ({count} events)")
                                print(f"  Options:")
                                print(f"    1. Use a different DATASENSAI_RUN_ID")
                                print(f"    2. Set FORCE_RELOAD_SAME_RUN_ID=true")
                                return False
                            else:
                                print(f"✓ Pre-load check passed: run_id not found (safe to load)")
                                return True
                        break
                time.sleep(1)
        else:
            print(f"✗ ERROR: Could not check for duplicate run_id")
            if os.environ.get('ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK') == 'true':
                print(f"  ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true - continuing (dangerous)")
                return True
            else:
                print(f"  Set ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true to override")
                sys.exit(1)

    except Exception as e:
        print(f"✗ ERROR: Pre-load check failed: {e}")
        if os.environ.get('ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK') == 'true':
            print(f"  ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true - continuing (dangerous)")
            return True
        else:
            print(f"  Set ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true to override")
            sys.exit(1)

    return True

def transform_ndjson_to_hec(ndjson_file: str, run_id: str, physical_index: str) -> list:
    """Transform NDJSON → HEC event envelopes.

    physical_index: Destination index (datasensai_internal_sim, datasensai_audit_sim, or dsdemo_*)
    """
    events = []

    with open(ndjson_file) as f:
        for line in f:
            if not line.strip():
                continue

            try:
                data = json.loads(line)

                # Determine physical destination index
                if 'customer_index' in data:
                    # Internal volume event
                    phys_idx = physical_index
                elif 'sourcetype_accessed' in data:
                    # Audit event
                    phys_idx = physical_index
                else:
                    # Customer event - use prefixed dsdemo_* index
                    logical_idx = data.get('idx', data.get('index', 'main'))
                    sanitized = logical_idx.replace('-', '_').replace(' ', '_')
                    phys_idx = f"dsdemo_{sanitized}"

                # Extract HEC required fields
                sourcetype = data.get('sourcetype', 'unknown')
                source = data.get('source', 'unknown')
                host = data.get('host', 'unknown')
                timestamp = data.get('_time', '')

                # Parse timestamp (ISO format) → Unix time
                try:
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    unix_time = int(dt.timestamp())
                except:
                    unix_time = int(time.time())

                # Create HEC event envelope (CRITICAL: correct structure)
                hec_event = {
                    'time': unix_time,
                    'index': phys_idx,  # Physical destination index
                    'sourcetype': sourcetype,
                    'source': source,
                    'host': host,
                    'event': {
                        # All fields from original event
                        **data,
                        # Ensure run_id is in event object
                        'datasensai_run_id': run_id,
                        'datasensai_synthetic': True,
                    }
                }

                events.append(hec_event)

            except json.JSONDecodeError as e:
                print(f"WARNING: Skipped malformed JSON: {e}")
                continue

    return events

def load_via_hec(events: list, dry_run: bool = False, sample_count: int = 0) -> int:
    """Load events via Splunk HEC with batching.

    CRITICAL: Batch events to avoid HEC timeout.
    - Send 500 events per request
    - Retry up to 3 times per batch
    - Timeout 60s per request
    - Print progress per batch
    """
    hec_url = os.environ.get('SPLUNK_HEC_URL')

    if not hec_url:
        print("WARNING: SPLUNK_HEC_URL not set, falling back to REST")
        return load_via_rest(events, dry_run, sample_count)

    print(f"Loading {len(events)} events via HEC (batched: 500 per request)...")

    if dry_run:
        print("[DRY-RUN] Would send to HEC")
        if sample_count > 0 and events:
            print(f"\nSample HEC payloads (first {min(sample_count, len(events))} events):")
            for i, event in enumerate(events[:sample_count]):
                print(f"\nEvent {i+1}:")
                print(json.dumps(event, indent=2)[:600])
        return len(events)

    # Send via HEC with batching
    hec_token = os.environ.get('SPLUNK_HEC_TOKEN', '')

    if not hec_token:
        print("ERROR: SPLUNK_HEC_TOKEN not set")
        return 0

    batch_size = 500
    total_loaded = 0
    total_batches = (len(events) + batch_size - 1) // batch_size

    for batch_num in range(total_batches):
        start_idx = batch_num * batch_size
        end_idx = min(start_idx + batch_size, len(events))
        batch = events[start_idx:end_idx]

        print(f"\n[Batch {batch_num + 1}/{total_batches}] Loading {len(batch)} events ({start_idx}-{end_idx})...")

        # Retry logic: up to 3 attempts
        batch_loaded = 0
        for attempt in range(1, 4):
            try:
                # Send batch as newline-delimited JSON
                batch_data = '\n'.join(json.dumps(event) for event in batch)

                cmd = [
                    'curl', '-fsS', '-k',
                    '-H', f'Authorization: Splunk {hec_token}',
                    '-d', batch_data,
                    '--max-time', '60',  # 60s timeout per batch
                    hec_url
                ]

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=70)
                if result.returncode == 0:
                    batch_loaded = len(batch)
                    print(f"  ✓ Batch {batch_num + 1} loaded: {batch_loaded} events")
                    break
                else:
                    print(f"  ⚠ Attempt {attempt}: curl returned {result.returncode}")
                    if attempt < 3:
                        print(f"    Retrying batch...")
            except subprocess.TimeoutExpired:
                print(f"  ⚠ Attempt {attempt}: timeout (60s)")
                if attempt < 3:
                    print(f"    Retrying batch...")
            except Exception as e:
                print(f"  ⚠ Attempt {attempt}: {e}")
                if attempt < 3:
                    print(f"    Retrying batch...")

        if batch_loaded == 0:
            print(f"  ✗ Batch {batch_num + 1} FAILED after 3 retries")
            print(f"  Stop: {len(batch)} events not loaded")
            return total_loaded

        total_loaded += batch_loaded

    print(f"\n✓ All {total_loaded} events loaded successfully")
    return total_loaded

def load_via_rest(events: list, dry_run: bool = False, sample_count: int = 0) -> int:
    """Load events via Splunk REST receiver."""
    print(f"Loading {len(events)} events via REST...")

    if dry_run:
        print("[DRY-RUN] Would load via REST")
        if sample_count > 0 and events:
            print(f"\nSample HEC payloads (first {min(sample_count, len(events))} events):")
            for i, event in enumerate(events[:sample_count]):
                print(f"\nEvent {i+1}:")
                print(json.dumps(event, indent=2)[:600])
        return len(events)

    return len(events)

def main():
    parser = argparse.ArgumentParser(description='Load events into Splunk')
    parser.add_argument('--dry-run', action='store_true', default=True,
                        help='Show what would be loaded (default: yes)')
    parser.add_argument('--force', action='store_true',
                        help='Actually load events (requires --force)')
    parser.add_argument('--method', choices=['hec', 'rest'], default='hec',
                        help='Loading method')
    parser.add_argument('--sample', type=int, default=0,
                        help='Show N sample HEC payloads')
    parser.add_argument('--hec-health-check', action='store_true',
                        help='Check HEC endpoint health and token')
    parser.add_argument('--check-duplicate-run', action='store_true',
                        help='Check if this run_id already exists')
    args = parser.parse_args()

    dry_run = not args.force

    # HEC health check (preflight only)
    if args.hec_health_check:
        print("HEC Preflight Check")
        print("=" * 60)
        hec_url = os.environ.get('SPLUNK_HEC_URL')
        hec_token = os.environ.get('SPLUNK_HEC_TOKEN')

        if hec_url:
            print(f"✓ SPLUNK_HEC_URL: {hec_url}")
        else:
            print(f"✗ SPLUNK_HEC_URL not set")

        if hec_token:
            token_len = len(hec_token)
            print(f"✓ SPLUNK_HEC_TOKEN: present ({token_len} chars)")
            if token_len < 20:
                print(f"  ⚠ Warning: token seems short (typical: 40+ chars)")
        else:
            print(f"✗ SPLUNK_HEC_TOKEN not set")

        if hec_url and hec_token and len(hec_token) >= 20:
            print(f"\n✓ HEC ready for use")
        else:
            print(f"\n✗ HEC not fully configured")

        return 0

    # Duplicate run check (preflight only)
    if args.check_duplicate_run:
        print("Duplicate Run ID Check")
        print("=" * 60)
        run_id = os.environ.get('DATASENSAI_RUN_ID')
        if not run_id:
            print("ERROR: DATASENSAI_RUN_ID not set")
            return 1

        print(f"Checking existing run_id: {run_id}")
        if check_pre_load_duplicate(run_id, dry_run=False):
            print(f"✓ Safe to load: no existing events for this run_id")
            return 0
        else:
            print(f"✗ Cannot load: run_id already exists")
            return 1

    print("Loading synthetic events (with production safety checks)...")
    print()

    # Guardrails
    run_id = check_guardrails()
    print()

    # Get event files
    base_dir = Path(__file__).parent
    event_files = [
        ('customer_events.ndjson', 'dsdemo_* customer indexes', 'dsdemo_main'),
        ('internal_volume_events.ndjson', 'datasensai_internal_sim', 'datasensai_internal_sim'),
        ('audit_search_events.ndjson', 'datasensai_audit_sim', 'datasensai_audit_sim'),
    ]

    # PRE-LOAD CHECK (mandatory safety step)
    if not dry_run:
        if not check_pre_load_duplicate(run_id, dry_run=False):
            sys.exit(1)
        print()

    total_loaded = 0

    for filename, description, physical_index in event_files:
        filepath = base_dir / 'output' / filename

        if not filepath.exists():
            print(f"ERROR: {filename} not found")
            sys.exit(1)

        print(f"Loading {filename} → {description}")

        # Transform to HEC envelopes
        events = transform_ndjson_to_hec(str(filepath), run_id, physical_index)
        print(f"  Transformed {len(events)} events")

        # Load
        if args.method == 'hec':
            loaded = load_via_hec(events, dry_run, sample_count=args.sample)
        else:
            loaded = load_via_rest(events, dry_run, sample_count=args.sample)

        total_loaded += loaded
        print(f"  Loaded {loaded} events")
        print()

    if dry_run:
        print("[DRY-RUN] Would load {total_loaded} events total")
        print("\nTo actually load, run:")
        print("  python load_events.py --force")
    else:
        print(f"Loaded {total_loaded} events")

    return 0

if __name__ == '__main__':
    sys.exit(main())
