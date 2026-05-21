Expected demo outcomes:
ROI ~ 68
Savings ~ 38k
Confidence ~ 88

Demo flow:
1. Push telemetry CSV to temporary Splunk index
2. Trigger refresh
3. Observe pipeline stages
4. Observe AI decisions
5. Observe KPI changes
6. Delete demo data after presentation

IMPORTANT:
- Use a dedicated temporary index only (e.g., demo_agentic)
- Do not push into production indexes
