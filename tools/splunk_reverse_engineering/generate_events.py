#!/usr/bin/env python3
"""
Generate synthetic log events from 1stmile_lookup.csv.

Purpose:
- Read the CSV
- For each row, generate realistic log events
- Preserve index/sourcetype/source/volume metadata
- Add DATASENSAI_RUN_ID to all events (prevents duplicate load corruption)
- Create three NDJSON files:
  1. customer_events.ndjson - actual logs from customer indexes
  2. internal_volume_events.ndjson - volume metadata (simulates _internal)
  3. audit_search_events.ndjson - search activity (simulates _audit)

Volume preservation:
- Sample events but keep volume metadata accurate
- Each event includes GB_idx_st_s and bytes_idx_st_s from the CSV
- All events marked datasensai_synthetic=true and datasensai_run_id=<unique-id>

CRITICAL: Without datasensai_run_id filtering, duplicate loads corrupt validation:
  - First load:  159.93 GB ✓
  - Second load: 319.86 GB ✗ (test fails silently)
  - With run_id: always 159.93 GB ✓
"""

import csv
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
import random
import hashlib
import os

# Message templates by sourcetype category
MESSAGE_TEMPLATES = {
    'windows': [
        'EventCode=4688 ProcessName="C:\\Windows\\System32\\svchost.exe" CommandLine="svchost.exe -k netsvcs"',
        'EventCode=4672 SubjectUserName=SYSTEM PrivilegeList=%{SYSTEM}',
        'EventCode=4674 ObjectName="\\Device\\HarddiskVolume2" AccessMask=0x1200A9',
    ],
    'apache': [
        '192.168.1.100 - - [datetime] "GET /index.html HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
        '192.168.1.101 - - [datetime] "POST /api/login HTTP/1.1" 401 256 "-" "curl/7.68.0"',
        '192.168.1.102 - - [datetime] "GET /admin HTTP/1.1" 403 128 "-" "Mozilla/5.0"',
    ],
    'tomcat': [
        '[datetime] INFO  org.apache.catalina.startup.Catalina.start Server startup in 5234 ms',
        '[datetime] ERROR org.apache.catalina.realm.RealmBase.backgroundProcess Exception closing realm background processor',
        '[datetime] WARN  org.apache.catalina.loader.WebappLoader.findResources Unable to create',
    ],
    'firewall': [
        'action="accept" src=192.168.1.5 dst=10.0.0.1 dstport=443 protocol=tcp',
        'action="deny" src=192.168.1.100 dst=192.168.1.1 dstport=22 protocol=tcp',
        'action="accept" src=192.168.2.0/24 dst=8.8.8.8 dstport=53 protocol=udp',
    ],
    'wazuh': [
        'agent_id=001 ruleid=5401 description="Local user login" hostname=server01',
        'agent_id=002 ruleid=5402 description="Authentication success" hostname=server02',
        'agent_id=003 ruleid=5403 description="Failed login attempt" hostname=server03',
    ],
    'aws': [
        'eventVersion="1.05" eventName="CreateBucket" eventSource="s3.amazonaws.com"',
        'eventVersion="1.05" eventName="PutObject" eventSource="s3.amazonaws.com"',
        'eventVersion="1.05" eventName="DeleteBucket" eventSource="s3.amazonaws.com"',
    ],
    'generic': [
        '[datetime] INFO: Process started with PID 1234',
        '[datetime] WARNING: High memory usage detected',
        '[datetime] ERROR: Connection timeout to database',
    ],
}

def get_message_template(sourcetype: str) -> str:
    """Get appropriate message template for sourcetype."""
    st_lower = sourcetype.lower()

    if 'registry' in st_lower or 'wineventlog' in st_lower or 'security' in st_lower:
        return random.choice(MESSAGE_TEMPLATES['windows'])
    elif 'apache' in st_lower:
        return random.choice(MESSAGE_TEMPLATES['apache'])
    elif 'tomcat' in st_lower:
        return random.choice(MESSAGE_TEMPLATES['tomcat'])
    elif any(x in st_lower for x in ['firewall', 'fgt', 'cisco', 'palo']):
        return random.choice(MESSAGE_TEMPLATES['firewall'])
    elif 'wazuh' in st_lower:
        return random.choice(MESSAGE_TEMPLATES['wazuh'])
    elif any(x in st_lower for x in ['aws', 'cloudtrail', 'firehose']):
        return random.choice(MESSAGE_TEMPLATES['aws'])
    else:
        return random.choice(MESSAGE_TEMPLATES['generic'])

def generate_customer_events(rows: list, output_file: str, run_id: str) -> int:
    """Generate customer log events from CSV rows.

    CRITICAL: Add datasensai_run_id to every event to prevent duplicate-load corruption.
    """
    event_count = 0
    seen_volumes = defaultdict(float)

    with open(output_file, 'w') as f:
        for i, row in enumerate(rows):
            try:
                index = row.get('index', '').strip()
                sourcetype = row.get('sourcetype', '').strip()
                source = row.get('source', '').strip()
                gb = float(row.get('GB_idx_st_s', 0))
                bytes_val = float(row.get('bytes_idx_st_s', 0))
                time_str = row.get('_time', '')

                if not index or gb == 0:
                    continue

                # Generate 3-5 sampled events per row to preserve metadata
                num_events = random.randint(3, 5)
                for j in range(num_events):
                    event = {
                        'index': index,
                        'sourcetype': sourcetype,
                        'source': source,
                        'host': f"{index}-host-{random.randint(1, 10)}",
                        '_time': time_str,
                        'GB_idx_st_s': gb,
                        'bytes_idx_st_s': bytes_val,
                        'datasensai_original_run_id': row.get('run_id', 'unknown'),
                        'datasensai_run_id': run_id,  # CRITICAL: for run_id-based filtering
                        'datasensai_synthetic': True,
                        'event_sequence': j,
                        'raw_message': get_message_template(sourcetype),
                    }
                    f.write(json.dumps(event) + '\n')
                    event_count += 1

            except (ValueError, TypeError) as e:
                print(f"WARNING: Skipped event generation for row {i}: {e}")
                continue

    return event_count

def generate_internal_volume_events(rows: list, output_file: str, run_id: str) -> int:
    """Generate internal volume metadata events.

    CRITICAL: Include datasensai_run_id to prevent duplicate-load corruption.
    """
    event_count = 0
    volume_by_idx_st = defaultdict(float)

    with open(output_file, 'w') as f:
        for row in rows:
            try:
                index = row.get('index', '').strip()
                sourcetype = row.get('sourcetype', '').strip()
                source = row.get('source', '').strip()
                gb = float(row.get('GB_idx_st_s', 0))
                bytes_val = float(row.get('bytes_idx_st_s', 0))
                time_str = row.get('_time', '')

                if not index or gb == 0:
                    continue

                # Create metadata event (one per unique index/sourcetype/source combo)
                event = {
                    '_time': time_str,
                    'index': index,
                    'idx': index,  # short form
                    'sourcetype': sourcetype,
                    'st': sourcetype[:20],  # abbreviated
                    'source': source,
                    'host': f"splunk-indexer-{random.randint(1, 3)}",
                    'b': bytes_val,  # bytes
                    'kb': bytes_val / 1024,
                    'gb': gb,
                    'bytes_idx_st_s': bytes_val,
                    'GB_idx_st_s': gb,
                    'license_pool': 'default',
                    'series': 'vol',
                    'datasensai_run_id': run_id,  # CRITICAL: for run_id-based filtering
                    'datasensai_synthetic': True,
                    'event_type': 'internal_volume_metadata',
                }
                f.write(json.dumps(event) + '\n')
                event_count += 1

            except (ValueError, TypeError) as e:
                print(f"WARNING: Skipped internal event for row: {e}")
                continue

    return event_count

def generate_audit_search_events(rows: list, output_file: str, run_id: str) -> int:
    """Generate audit/search activity events.

    Purpose: Utilization scoring needs varied search patterns.
    - High-volume sourcetypes: more searches
    - Some high-volume: intentionally low searches (optimization opportunity)
    - Low-volume: few or zero searches

    CRITICAL: Include datasensai_run_id to prevent duplicate-load corruption.
    """
    event_count = 0

    # Group rows by sourcetype to generate realistic utilization
    st_volumes = defaultdict(float)
    for row in rows:
        st = row.get('sourcetype', '').strip()
        gb = float(row.get('GB_idx_st_s', 0))
        st_volumes[st] += gb

    # Sorted by volume
    sorted_st = sorted(st_volumes.items(), key=lambda x: x[1], reverse=True)

    with open(output_file, 'w') as f:
        for rank, (sourcetype, vol_gb) in enumerate(sorted_st):
            # Search frequency based on rank and volume
            if rank < 5:
                # Top 5 sourcetypes: generate 20-40 searches
                num_searches = random.randint(20, 40)
            elif rank < 10:
                # Next 10: generate 5-15 searches
                num_searches = random.randint(5, 15)
            else:
                # Lower volume: 0-5 searches (some not searched at all)
                num_searches = random.randint(0, 5)

            for s in range(num_searches):
                event = {
                    '_time': (datetime.now() - timedelta(days=random.randint(0, 30))).isoformat(),
                    'user': random.choice(['admin', 'analyst', 'engineer', 'team_a']),
                    'action': 'search',
                    'search_id': hashlib.md5(f"{sourcetype}_{s}".encode()).hexdigest()[:16],
                    'savedsearch_name': f"datasensai_analysis_{sourcetype.replace(':', '_')}",
                    'app': 'datasensai_demo',
                    'info': 'completed',
                    'total_run_time': round(random.uniform(0.5, 30), 2),
                    'result_count': random.randint(10, 10000),
                    'index_accessed': '',
                    'sourcetype_accessed': sourcetype,
                    'datasensai_run_id': run_id,  # CRITICAL: for run_id-based filtering
                    'datasensai_synthetic': True,
                }
                f.write(json.dumps(event) + '\n')
                event_count += 1

    return event_count

def main():
    """Main entry point."""
    base_dir = Path(__file__).parent
    csv_path = base_dir / 'fixtures' / '1stmile_lookup.csv'
    output_dir = base_dir / 'output'

    # Generate or use provided run_id
    run_id = os.environ.get('DATASENSAI_RUN_ID', f'1stmile-demo-{datetime.now().strftime("%Y%m%d-%H%M%S")}')
    print(f"Using DATASENSAI_RUN_ID: {run_id}")
    print("(Override with: export DATASENSAI_RUN_ID=custom-id)")
    print()

    # Read CSV
    print(f"Reading CSV: {csv_path}")
    rows = []
    try:
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except FileNotFoundError:
        print(f"ERROR: {csv_path} not found")
        sys.exit(1)

    print(f"  Loaded {len(rows)} rows")

    # Generate events (inject run_id into each function)
    print("\nGenerating customer log events...")
    output_dir.mkdir(parents=True, exist_ok=True)
    customer_count = generate_customer_events(rows, str(output_dir / 'customer_events.ndjson'), run_id)
    print(f"  ✓ Generated {customer_count} customer events")

    print("Generating internal volume metadata events...")
    internal_count = generate_internal_volume_events(rows, str(output_dir / 'internal_volume_events.ndjson'), run_id)
    print(f"  ✓ Generated {internal_count} internal volume events")

    print("Generating audit/search activity events...")
    audit_count = generate_audit_search_events(rows, str(output_dir / 'audit_search_events.ndjson'), run_id)
    print(f"  ✓ Generated {audit_count} audit search events")

    print(f"\n✓ All events generated to {output_dir}/")
    print(f"✓ Run ID embedded in all events: {run_id}")
    print(f"✓ All events marked: datasensai_synthetic=true")
    print()
    print("Next: Use this run_id in validation queries:")
    print(f"  index=datasensai_internal_sim datasensai_run_id=\"{run_id}\" datasensai_synthetic=true")
    return 0

if __name__ == '__main__':
    sys.exit(main())
