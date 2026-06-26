#!/usr/bin/env python3
"""
Reverse engineer 1stmile_lookup.csv into metadata summary.

Purpose:
- Read the CSV
- Validate required columns
- Remove duplicates
- Calculate summary statistics
- Output expected_summary.json for validation

This summary is used by:
1. generate_events.py to create synthetic events
2. validate_demo_environment.py to verify correctness
"""

import csv
import json
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set, Tuple

REQUIRED_COLUMNS = {'GB_idx_st_s', '_time', 'bytes_idx_st_s', 'index', 'run_id', 'source', 'sourcetype'}

def read_csv(csv_path: str) -> List[Dict]:
    """Read 1stmile CSV and return rows."""
    try:
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                print(f"ERROR: CSV is empty: {csv_path}")
                sys.exit(1)
            rows = list(reader)
            return rows
    except FileNotFoundError:
        print(f"ERROR: File not found: {csv_path}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to read CSV: {e}")
        sys.exit(1)

def validate_columns(rows: List[Dict]) -> None:
    """Ensure required columns exist."""
    if not rows:
        print("ERROR: CSV has no rows")
        sys.exit(1)

    headers = set(rows[0].keys())
    missing = REQUIRED_COLUMNS - headers
    if missing:
        print(f"ERROR: Missing required columns: {missing}")
        print(f"Found columns: {headers}")
        sys.exit(1)

def remove_duplicates(rows: List[Dict]) -> Tuple[List[Dict], int]:
    """Remove exact duplicate rows, return unique rows and duplicate count."""
    seen = set()
    unique = []
    duplicates = 0

    for row in rows:
        row_tuple = tuple(sorted(row.items()))
        if row_tuple not in seen:
            seen.add(row_tuple)
            unique.append(row)
        else:
            duplicates += 1

    return unique, duplicates

def calculate_summary(rows: List[Dict]) -> Dict:
    """Calculate metadata summary from unique rows."""

    # Initialize counters
    indexes_seen: Set[str] = set()
    sourcetypes_seen: Set[str] = set()
    sources_seen: Set[str] = set()

    volume_by_index: Dict[str, float] = defaultdict(float)
    volume_by_sourcetype: Dict[str, float] = defaultdict(float)
    volume_by_source: Dict[str, float] = defaultdict(float)

    total_gb = 0.0
    total_bytes = 0

    for row in rows:
        try:
            # Extract fields
            index = row.get('index', '').strip()
            sourcetype = row.get('sourcetype', '').strip()
            source = row.get('source', '').strip()

            gb = float(row.get('GB_idx_st_s', 0))
            bytes_val = float(row.get('bytes_idx_st_s', 0))

            # Skip if no index
            if not index:
                continue

            # Accumulate
            indexes_seen.add(index)
            sourcetypes_seen.add(sourcetype)
            sources_seen.add(source)

            volume_by_index[index] += gb
            volume_by_sourcetype[sourcetype] += gb
            volume_by_source[source] += gb

            total_gb += gb
            total_bytes += bytes_val

        except (ValueError, TypeError) as e:
            print(f"WARNING: Skipped row due to parse error: {row}")
            continue

    if total_gb == 0:
        print("WARNING: Total GB is zero. Check CSV data.")

    # Sort by volume descending
    top_indexes = sorted(volume_by_index.items(), key=lambda x: x[1], reverse=True)[:10]
    top_sourcetypes = sorted(volume_by_sourcetype.items(), key=lambda x: x[1], reverse=True)[:10]
    top_sources = sorted(volume_by_source.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        'metadata': {
            'file': 'fixtures/1stmile_lookup.csv',
            'parser_version': '1.0',
        },
        'counts': {
            'total_rows': len(rows),
            'index_count': len(indexes_seen),
            'sourcetype_count': len(sourcetypes_seen),
            'source_count': len(sources_seen),
        },
        'volume': {
            'total_daily_gb': round(total_gb, 2),
            'total_daily_bytes': int(total_bytes),
        },
        'top_10_indexes': [{'index': idx, 'daily_gb': round(gb, 2)} for idx, gb in top_indexes],
        'top_10_sourcetypes': [{'sourcetype': st, 'daily_gb': round(gb, 2)} for st, gb in top_sourcetypes],
        'top_10_sources': [{'source': src, 'daily_gb': round(gb, 2)} for src, gb in top_sources[:5]],
        'all_indexes': sorted(list(indexes_seen)),
        'all_sourcetypes': sorted(list(sourcetypes_seen)),
    }

def main():
    """Main entry point."""
    base_dir = Path(__file__).parent
    csv_path = base_dir / 'fixtures' / '1stmile_lookup.csv'
    output_path = base_dir / 'output' / 'expected_summary.json'

    print(f"Reading CSV: {csv_path}")
    rows = read_csv(str(csv_path))
    print(f"  Loaded {len(rows)} rows")

    print("Validating columns...")
    validate_columns(rows)
    print("  ✓ All required columns present")

    print("Removing duplicates...")
    unique_rows, dup_count = remove_duplicates(rows)
    print(f"  ✓ Removed {dup_count} duplicates, {len(unique_rows)} rows unique")

    print("Calculating summary...")
    summary = calculate_summary(unique_rows)
    print(f"  ✓ Total daily volume: {summary['volume']['total_daily_gb']} GB")
    print(f"  ✓ Indexes: {summary['counts']['index_count']}")
    print(f"  ✓ Sourcetypes: {summary['counts']['sourcetype_count']}")
    print(f"  ✓ Sources: {summary['counts']['source_count']}")

    print(f"Writing summary: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"  ✓ Summary written")

    return 0

if __name__ == '__main__':
    sys.exit(main())
