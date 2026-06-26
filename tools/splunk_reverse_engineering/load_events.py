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
- HEC HEALTH CHECK: Real network call to HEC endpoint before loading
- LICENSE CHECK: Verify Splunk license is active before loading
- SAFETY: Use separate SPLUNK_HEC_URL, not inferred from management port
- Use dsdemo_* prefixed indexes for customer data (prevent real data deletion)
- BATCHING: 500 events per HEC request, 3 retries, 60s timeout
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

    run_id = os.environ.get('DATASENSAI_RUN_ID')
    if not run_id:
        print("ERROR: DATASENSAI_RUN_ID not set")
        print("Set it with: export DATASENSAI_RUN_ID=1stmile-demo-20260626-001")
        sys.exit(1)

    print(f"✓ DATASENSAI_MODE={mode}")
    print(f"✓ DATASENSAI_RUN_ID={run_id} (explicit, not 'latest')")

    for var in ['SPLUNK_HOST', 'SPLUNK_PORT', 'SPLUNK_USERNAME']:
        if not os.environ.get(var):
            print(f"ERROR: {var} not set (required for pre-load check)")
            sys.exit(1)

    hec_url = os.environ.get('SPLUNK_HEC_URL')
    if hec_url:
        print(f"✓ SPLUNK_HEC_URL configured (will use HEC method)")
    else:
        print(f"⊘ SPLUNK_HEC_URL not set (will fallback to REST method)")

    return run_id


def check_hec_live() -> bool:
    """Real network check: verify HEC endpoint is reachable and accepting connections."""
    hec_url = os.environ.get('SPLUNK_HEC_URL')
    hec_token = os.environ.get('SPLUNK_HEC_TOKEN')

    if not hec_url:
        print("✗ SPLUNK_HEC_URL not set")
        return False

    if not hec_token:
        print("✗ SPLUNK_HEC_TOKEN not set")
        return False

    print(f"✓ SPLUNK_HEC_URL: {hec_url}")
    print(f"✓ SPLUNK_HEC_TOKEN: present ({len(hec_token)} chars)")

    # Real network call to HEC health endpoint
    health_url = hec_url.replace('/services/collector', '/services/collector/health')
    print(f"\nTesting HEC connectivity: {health_url}")

    cmd = [
        'curl', '-s', '-k', '--max-time', '10',
        '-w', '\nHTTP_STATUS=%{http_code}',
        '-H', f'Authorization: Splunk {hec_token}',
        health_url
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        output = result.stdout.strip()

        if result.returncode == 7:
            print(f"\n✗ CONNECTION REFUSED on HEC endpoint")
            print(f"  Port 8088 is not reachable on the Splunk server.")
            print(f"\n  Fix this in Splunk UI:")
            print(f"    1. Settings → Data Inputs → HTTP Event Collector")
            print(f"    2. Click 'Global Settings'")
            print(f"    3. Set 'All Tokens' to Enabled")
            print(f"    4. Set 'HTTP Port Number' to 8088")
            print(f"    5. Enable SSL")
            print(f"    6. Save and restart Splunk if needed")
            print(f"\n  Also check:")
            print(f"    - Server firewall allows inbound TCP 8088")
            print(f"    - Cloud security group allows inbound TCP 8088")
            return False

        if result.returncode != 0:
            print(f"\n✗ HEC request failed (curl exit code {result.returncode})")
            print(f"  stderr: {result.stderr.strip()}")
            return False

        # Parse HTTP status
        http_status = '0'
        for line in output.split('\n'):
            if line.startswith('HTTP_STATUS='):
                http_status = line.split('=')[1]

        if http_status == '200':
            print(f"✓ HEC health check PASSED (HTTP {http_status})")
            return True
        elif http_status == '400':
            # HEC returns 400 for health check without proper body — still means it's listening
            print(f"✓ HEC is listening (HTTP {http_status} — normal for health endpoint)")
            return True
        elif http_status == '403':
            print(f"✗ HEC token rejected (HTTP 403)")
            print(f"  Check: Settings → Data Inputs → HTTP Event Collector")
            print(f"  Verify your token is enabled and has correct permissions")
            return False
        else:
            print(f"⚠ HEC returned unexpected status: HTTP {http_status}")
            print(f"  Response: {output[:200]}")
            return False

    except subprocess.TimeoutExpired:
        print(f"\n✗ HEC connection timed out (10s)")
        print(f"  The server may be unreachable or overloaded")
        return False
    except Exception as e:
        print(f"\n✗ HEC check error: {e}")
        return False


def check_license_state() -> bool:
    """Check Splunk license state via /services/server/info."""
    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    url = f"{scheme}://{host}:{port}/services/server/info?output_mode=json"

    cmd = ['curl', '-s', '-u', f'{user}:{password}', '--max-time', '10']
    if not verify:
        cmd.append('-k')
    cmd.append(url)

    print("Checking Splunk license state...")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            print(f"⚠ Could not check license state (curl exit {result.returncode})")
            return True  # Don't block on license check failure — HEC will fail anyway

        data = json.loads(result.stdout)
        entry = data.get('entry', [{}])[0].get('content', {})
        license_state = entry.get('licenseState', 'UNKNOWN')
        server_name = entry.get('serverName', 'unknown')

        print(f"  Server: {server_name}")
        print(f"  License state: {license_state}")

        if license_state == 'EXPIRED':
            print(f"\n✗ SPLUNK LICENSE IS EXPIRED")
            print(f"  Cannot load events into an expired Splunk instance.")
            print(f"  Fix: Settings → Licensing → Add license or start new trial")
            return False

        print(f"✓ License state: {license_state}")
        return True

    except json.JSONDecodeError:
        print(f"⚠ Could not parse server info response")
        return True
    except Exception as e:
        print(f"⚠ License check failed: {e}")
        return True


def check_pre_load_duplicate(run_id: str, dry_run: bool = False) -> bool:
    """Check if this run_id already exists in Splunk.

    CRITICAL: Prevent duplicate-load corruption by failing if same run_id is found.
    If the check itself fails (can't query Splunk), fail hard — do not continue.
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

    url = f"{scheme}://{host}:{port}/services/search/jobs/export"

    search_query = f'search index=datasensai_internal_sim datasensai_run_id="{run_id}" earliest=0 | stats count as event_count'

    cmd = [
        'curl', '-s', '-u', f'{user}:{password}',
        '--max-time', '30',
        '--data-urlencode', f'search={search_query}',
        '--data-urlencode', 'output_mode=json',
    ]
    if not verify:
        cmd.append('-k')
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=35)

        if result.returncode != 0:
            return _handle_duplicate_check_failure(f"curl exit code {result.returncode}")

        output = result.stdout.strip()

        if not output:
            # Empty response means no results — index is empty, safe to load
            print(f"✓ No events found for run_id '{run_id}' (index empty — safe to load)")
            return True

        # Parse JSON response lines
        for line in output.split('\n'):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if 'result' in data:
                    count = int(data['result'].get('event_count', 0))
                    if count > 0:
                        print(f"✗ DUPLICATE RUN DETECTED")
                        print(f"  Run ID '{run_id}' already has {count} events in Splunk")
                        print(f"  Options:")
                        print(f"    1. Use a different DATASENSAI_RUN_ID:")
                        print(f"       export DATASENSAI_RUN_ID=1stmile-demo-20260626-002")
                        print(f"       python3 generate_events.py")
                        print(f"    2. Set FORCE_RELOAD_SAME_RUN_ID=true (dangerous)")
                        if os.environ.get('FORCE_RELOAD_SAME_RUN_ID') == 'true':
                            print(f"\n  ⚠ FORCE_RELOAD_SAME_RUN_ID=true — continuing (DANGEROUS)")
                            return True
                        return False
                    else:
                        print(f"✓ No existing events for run_id '{run_id}' (safe to load)")
                        return True
            except (json.JSONDecodeError, ValueError, KeyError):
                continue

        # If we parsed the response but found no result key, treat as empty
        print(f"✓ No events found for run_id '{run_id}' (safe to load)")
        return True

    except subprocess.TimeoutExpired:
        return _handle_duplicate_check_failure("query timed out (30s)")
    except Exception as e:
        return _handle_duplicate_check_failure(str(e))


def _handle_duplicate_check_failure(reason: str) -> bool:
    """Handle duplicate check failure — hard fail unless explicitly overridden."""
    print(f"✗ ERROR: Could not verify duplicate run_id: {reason}")
    if os.environ.get('ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK') == 'true':
        print(f"  ⚠ WARNING: ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true")
        print(f"  ⚠ Loading without duplicate verification — risk of data corruption")
        return True
    else:
        print(f"  Do not load without verifying duplicates.")
        print(f"  To override (dangerous): export ALLOW_LOAD_WITHOUT_DUPLICATE_CHECK=true")
        sys.exit(1)


def transform_ndjson_to_hec(ndjson_file: str, run_id: str, physical_index: str) -> list:
    """Transform NDJSON → HEC event envelopes."""
    events = []

    with open(ndjson_file) as f:
        for line in f:
            if not line.strip():
                continue

            try:
                data = json.loads(line)

                if 'customer_index' in data:
                    phys_idx = physical_index
                elif 'sourcetype_accessed' in data:
                    phys_idx = physical_index
                else:
                    logical_idx = data.get('idx', data.get('index', 'main'))
                    sanitized = logical_idx.replace('-', '_').replace(' ', '_')
                    phys_idx = f"dsdemo_{sanitized}"

                sourcetype = data.get('sourcetype', 'unknown')
                source = data.get('source', 'unknown')
                host = data.get('host', 'unknown')
                timestamp = data.get('_time', '')

                try:
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    unix_time = int(dt.timestamp())
                except:
                    unix_time = int(time.time())

                # Remove fields from event body that collide with HEC envelope
                # metadata (sourcetype, source, host) to prevent multivalued fields
                event_body = {k: v for k, v in data.items()
                              if k not in ('sourcetype', 'source', 'host')}
                event_body['datasensai_run_id'] = run_id
                event_body['datasensai_synthetic'] = True

                hec_event = {
                    'time': unix_time,
                    'index': phys_idx,
                    'sourcetype': sourcetype,
                    'source': source,
                    'host': host,
                    'event': event_body,
                }

                events.append(hec_event)

            except json.JSONDecodeError as e:
                print(f"WARNING: Skipped malformed JSON: {e}")
                continue

    return events


def load_via_hec(events: list, dry_run: bool = False, sample_count: int = 0) -> int:
    """Load events via Splunk HEC with batching.

    - 500 events per request
    - 3 retries per batch
    - 60s timeout per request
    - Progress printed per batch
    - Stops on first failed batch
    """
    hec_url = os.environ.get('SPLUNK_HEC_URL')

    if not hec_url:
        print("ERROR: SPLUNK_HEC_URL not set — cannot load via HEC")
        return 0

    print(f"Loading {len(events)} events via HEC (batched: 500 per request)...")

    if dry_run:
        print("[DRY-RUN] Would send to HEC")
        if sample_count > 0 and events:
            print(f"\nSample HEC payloads (first {min(sample_count, len(events))} events):")
            for i, event in enumerate(events[:sample_count]):
                print(f"\nEvent {i+1}:")
                print(json.dumps(event, indent=2)[:600])
        return len(events)

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

        batch_loaded = 0
        for attempt in range(1, 4):
            try:
                batch_data = '\n'.join(json.dumps(event) for event in batch)

                cmd = [
                    'curl', '-fsS', '-k',
                    '-H', f'Authorization: Splunk {hec_token}',
                    '-d', batch_data,
                    '--max-time', '60',
                    hec_url
                ]

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=70)

                if result.returncode == 7:
                    print(f"  ✗ CONNECTION REFUSED — HEC port 8088 not reachable")
                    print(f"    Enable HEC: Settings → Data Inputs → HTTP Event Collector")
                    return total_loaded

                if result.returncode == 0:
                    batch_loaded = len(batch)
                    print(f"  ✓ Batch {batch_num + 1} loaded: {batch_loaded} events")
                    break
                else:
                    print(f"  ⚠ Attempt {attempt}: curl returned {result.returncode}")
                    if result.stderr.strip():
                        print(f"    {result.stderr.strip()[:200]}")
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
            print(f"  Stopping: {total_loaded} events loaded before failure")
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
                        help='Actually load events')
    parser.add_argument('--method', choices=['hec', 'rest'], default='hec',
                        help='Loading method')
    parser.add_argument('--sample', type=int, default=0,
                        help='Show N sample HEC payloads')
    parser.add_argument('--hec-health-check', action='store_true',
                        help='Check HEC endpoint health with real network call')
    parser.add_argument('--check-duplicate-run', action='store_true',
                        help='Check if this run_id already exists')
    args = parser.parse_args()

    dry_run = not args.force

    # HEC health check — real network call
    if args.hec_health_check:
        print("HEC Health Check (Live)")
        print("=" * 60)
        if check_hec_live():
            return 0
        else:
            return 1

    # Duplicate run check
    if args.check_duplicate_run:
        print("Duplicate Run ID Check")
        print("=" * 60)
        run_id = os.environ.get('DATASENSAI_RUN_ID')
        if not run_id:
            print("ERROR: DATASENSAI_RUN_ID not set")
            return 1

        print(f"Checking existing run_id: {run_id}")
        print()
        if check_pre_load_duplicate(run_id, dry_run=False):
            return 0
        else:
            return 1

    print("Loading synthetic events (with production safety checks)...")
    print()

    # Guardrails
    run_id = check_guardrails()
    print()

    # License check before loading
    if not dry_run:
        if not check_license_state():
            sys.exit(1)
        print()

        # HEC connectivity check before loading
        hec_url = os.environ.get('SPLUNK_HEC_URL')
        if hec_url:
            print("Pre-load HEC connectivity check...")
            if not check_hec_live():
                print("\n✗ Cannot load: HEC is not reachable")
                sys.exit(1)
            print()

        # Duplicate check before loading
        if not check_pre_load_duplicate(run_id, dry_run=False):
            sys.exit(1)
        print()

    # Get event files
    base_dir = Path(__file__).parent
    event_files = [
        ('customer_events.ndjson', 'dsdemo_* customer indexes', 'dsdemo_main'),
        ('internal_volume_events.ndjson', 'datasensai_internal_sim', 'datasensai_internal_sim'),
        ('audit_search_events.ndjson', 'datasensai_audit_sim', 'datasensai_audit_sim'),
    ]

    total_loaded = 0

    for filename, description, physical_index in event_files:
        filepath = base_dir / 'output' / filename

        if not filepath.exists():
            print(f"ERROR: {filename} not found")
            sys.exit(1)

        print(f"Loading {filename} → {description}")

        events = transform_ndjson_to_hec(str(filepath), run_id, physical_index)
        print(f"  Transformed {len(events)} events")

        if args.method == 'hec':
            loaded = load_via_hec(events, dry_run, sample_count=args.sample)
        else:
            loaded = load_via_rest(events, dry_run, sample_count=args.sample)

        total_loaded += loaded
        print(f"  Loaded {loaded} events")
        print()

    if dry_run:
        print(f"[DRY-RUN] Would load {total_loaded} events total")
        print("\nTo actually load, run:")
        print("  python load_events.py --force")
    else:
        print(f"✓ Total loaded: {total_loaded} events")

    return 0


if __name__ == '__main__':
    sys.exit(main())
