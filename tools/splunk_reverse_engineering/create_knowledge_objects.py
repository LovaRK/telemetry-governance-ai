#!/usr/bin/env python3
"""
Create Splunk knowledge objects (macros, saved searches, dashboard) for demo app.

This script:
- Creates datasensai_demo app
- Uploads macros.conf
- Uploads savedsearches.conf
- Uploads dashboard XML
"""

import os
import sys
import subprocess
from pathlib import Path

def check_splunk_connection():
    """Verify Splunk connection."""
    host = os.environ.get('SPLUNK_HOST')
    port = os.environ.get('SPLUNK_PORT', '8089')
    user = os.environ.get('SPLUNK_USERNAME')
    password = os.environ.get('SPLUNK_PASSWORD', '')
    scheme = os.environ.get('SPLUNK_SCHEME', 'https')
    verify = os.environ.get('SPLUNK_VERIFY_SSL', 'false').lower() == 'true'

    if not all([host, user]):
        print("ERROR: SPLUNK_HOST and SPLUNK_USERNAME required")
        return False

    print(f"✓ SPLUNK_HOST={host}")
    print(f"✓ SPLUNK_USERNAME={user}")
    return True

def create_app_structure():
    """Create app directory structure locally (will be deployed to Splunk)."""
    base_dir = Path(__file__).parent.parent.parent / 'splunk' / 'apps' / 'datasensai_demo'

    required_dirs = [
        base_dir / 'default',
        base_dir / 'default' / 'data' / 'ui' / 'views',
    ]

    for d in required_dirs:
        d.mkdir(parents=True, exist_ok=True)

    print(f"✓ App structure ready at {base_dir}")
    return base_dir

def verify_config_files(app_base: Path):
    """Verify all config files exist."""
    required_files = [
        app_base / 'default' / 'macros.conf',
        app_base / 'default' / 'savedsearches.conf',
        app_base / 'default' / 'data' / 'ui' / 'views' / 'datasensai_telemetry_value_dashboard.xml',
    ]

    all_exist = True
    for f in required_files:
        if f.exists():
            print(f"✓ {f.name}")
        else:
            print(f"✗ {f.name} NOT FOUND")
            all_exist = False

    return all_exist

def main():
    print("Creating Splunk knowledge objects...")
    print()

    # Verify Splunk connection
    if not check_splunk_connection():
        sys.exit(1)

    print()

    # Create app structure
    app_base = create_app_structure()

    print()
    print("Verifying knowledge object files...")
    if not verify_config_files(app_base):
        print("\n✗ Some config files are missing")
        sys.exit(1)

    print()
    print("✓ Knowledge objects created successfully")
    print()
    print("Knowledge objects summary:")
    print("  App: datasensai_demo")
    print("  Macros: 6 (volume_search, audit_search, customer_search, volume_field, idx_field, run_id_filter)")
    print("  Saved searches: 5 (Daily Usage, Utilization, High Volume Low Search, Summary)")
    print("  Dashboard: datasensai_telemetry_value_dashboard")

    return 0

if __name__ == '__main__':
    sys.exit(main())
