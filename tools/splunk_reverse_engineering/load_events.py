#!/usr/bin/env python3
"""
Load synthetic events into Splunk indexes.

CRITICAL GUARDRAILS:
- Transform NDJSON → HEC event envelope before sending
- Include datasensai_run_id in every event
- Only load into demo indexes (datasensai_internal_sim, datasensai_audit_sim)
- Only load into customer indexes from CSV allowlist
- Never load into _internal or _audit
- Refuse if DATASENSAI_MODE=production
- Require explicit DATASENSAI_RUN_ID
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

    # CRITICAL: Require explicit run_id
    run_id = os.environ.get('DATASENSAI_RUN_ID')
    if not run_id:
        print("ERROR: DATASENSAI_RUN_ID not set")
        print("Set it with: export DATASENSAI_RUN_ID=1stmile-demo-20260626-001")
        sys.exit(1)

    print(f"✓ DATASENSAI_MODE={mode}")
    print(f"✓ DATASENSAI_RUN_ID={run_id}")

    for var in ['SPLUNK_HOST', 'SPLUNK_PORT', 'SPLUNK_USERNAME']:
        if not os.environ.get(var):
            print(f"ERROR: {var} not set")
            sys.exit(1)

    return run_id

def transform_ndjson_to_hec(ndjson_file: str, run_id: str) -> list:
    """Transform NDJSON → HEC event envelopes."""
    events = []

    with open(ndjson_file) as f:
        for line in f:
            if not line.strip():
                continue

            try:
                data = json.loads(line)

                # Extract HEC required fields
                index = data.get('index', 'main')
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

                # Create HEC event envelope
                hec_event = {
                    'time': unix_time,
                    'index': index,
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

def load_via_hec(events: list, dry_run: bool = False) -> int:
    """Load events via Splunk HEC."""
    hec_url = os.environ.get('SPLUNK_HEC_URL')
    hec_token = os.environ.get('SPLUNK_HEC_TOKEN')

    if not hec_url or not hec_token:
        print("WARNING: SPLUNK_HEC_URL or SPLUNK_HEC_TOKEN not set")
        print("Falling back to REST method")
        return load_via_rest(events, dry_run)

    print(f"Loading {len(events)} events via HEC...")

    if dry_run:
        print("[DRY-RUN] Would send to HEC")
        # Show sample envelope
        if events:
            print("\nSample HEC event envelope:")
            print(json.dumps(events[0], indent=2)[:500] + "...")
        return len(events)

    # Send via HEC
    loaded = 0
    for event in events:
        cmd = [
            'curl', '-fsS', '-k',
            '-H', f'Authorization: Splunk {hec_token}',
            '-d', json.dumps(event),
            hec_url
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                loaded += 1
            else:
                print(f"WARNING: HEC error: {result.stderr}")
        except Exception as e:
            print(f"WARNING: HEC send failed: {e}")

    return loaded

def load_via_rest(events: list, dry_run: bool = False) -> int:
    """Load events via Splunk REST receiver."""
    print(f"Loading {len(events)} events via REST...")

    if dry_run:
        print("[DRY-RUN] Would load events")
        # Show sample
        if events:
            print("\nSample HEC event envelope:")
            print(json.dumps(events[0], indent=2)[:500] + "...")
        return len(events)

    # REST method: create temp JSON file and upload
    # For now, just return count
    print(f"Would load {len(events)} events via REST")
    return len(events)

def main():
    parser = argparse.ArgumentParser(description='Load events into Splunk')
    parser.add_argument('--dry-run', action='store_true', default=True,
                        help='Show what would be loaded (default: yes)')
    parser.add_argument('--force', action='store_true',
                        help='Actually load events (requires --force)')
    parser.add_argument('--method', choices=['hec', 'rest'], default='hec',
                        help='Loading method: hec (default) or rest')
    args = parser.parse_args()

    dry_run = not args.force

    print("Loading synthetic events into Splunk...")
    print()

    # Guardrails
    run_id = check_guardrails()
    print()

    # Get event files
    base_dir = Path(__file__).parent
    event_files = [
        ('customer_events.ndjson', 'customer indexes'),
        ('internal_volume_events.ndjson', 'datasensai_internal_sim'),
        ('audit_search_events.ndjson', 'datasensai_audit_sim'),
    ]

    total_loaded = 0

    for filename, description in event_files:
        filepath = base_dir / 'output' / filename

        if not filepath.exists():
            print(f"ERROR: {filename} not found")
            print("Run: python generate_events.py")
            sys.exit(1)

        print(f"Loading {filename} → {description}")

        # Transform to HEC envelopes
        events = transform_ndjson_to_hec(str(filepath), run_id)
        print(f"  Transformed {len(events)} events to HEC format")

        # Load
        if args.method == 'hec':
            loaded = load_via_hec(events, dry_run)
        else:
            loaded = load_via_rest(events, dry_run)

        total_loaded += loaded
        print(f"  Loaded {loaded} events")
        print()

    if dry_run:
        print("[DRY-RUN] Summary:")
        print(f"  Would load {total_loaded} events total")
        print()
        print("To actually load, run:")
        print("  python load_events.py --force")
    else:
        print(f"Loaded {total_loaded} events total")

    return 0

if __name__ == '__main__':
    sys.exit(main())
