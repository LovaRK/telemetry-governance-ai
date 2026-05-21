#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <splunk_base_url> <hec_token> <index> [source] [sourcetype]"
  echo "Example: $0 https://144.202.48.85:8088 ABC123 demo_agentic telemetry_demo csv"
  exit 1
fi

SPLUNK_BASE_URL="$1"      # e.g. https://144.202.48.85:8088
HEC_TOKEN="$2"
INDEX="$3"
SOURCE="${4:-telemetry_demo}"
SOURCETYPE="${5:-csv}"
CSV_PATH="demo_pack/datasets/telemetry_snapshots_demo.csv"

if [[ ! -f "$CSV_PATH" ]]; then
  echo "Missing CSV file: $CSV_PATH"
  exit 1
fi

# Skip header, send one event per row as JSON payload carrying raw CSV row
TAIL_ROWS=$(tail -n +2 "$CSV_PATH")

while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  json=$(jq -Rn --arg row "$row" --arg index "$INDEX" --arg source "$SOURCE" --arg sourcetype "$SOURCETYPE" \
    '{time:(now|floor), index:$index, source:$source, sourcetype:$sourcetype, event:$row}')

  curl -sS -k -X POST "$SPLUNK_BASE_URL/services/collector" \
    -H "Authorization: Splunk $HEC_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$json" >/dev/null

done <<< "$TAIL_ROWS"

echo "Demo data pushed to index=$INDEX via HEC"
