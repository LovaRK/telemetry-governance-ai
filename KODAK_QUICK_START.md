# ⚡ KODAK QUICK START — Locked Handoff Summary

**Pull from:** `fix/layman-friendly-installer` branch  
**Repository:** `https://github.com/LovaRK/telemetry-governance-ai.git`  
**Pinned validation commit:** `db5b6f6`  
**Start date:** June 26, 2026  
**Status:** run_id 004 data generated, ready for validation

---

## 🎯 Your Immediate Tasks (In Order)

### 1. Pull the Code
```bash
git clone https://github.com/LovaRK/telemetry-governance-ai.git
cd telemetry-governance-ai
git checkout fix/layman-friendly-installer
git rev-parse --short HEAD   # Expect db5b6f6 or a reviewed descendant
```

### 2. Read the Handoff Doc
```bash
cat HANDOVER_TO_KODAK.md
# Read the LOCKED FINAL DECISIONS section first
# Then read the full checklist below
```

### 3. Set Up SSH Tunnel (HEC Access)
```bash
# Terminal 1 (keep running):
ssh -L 8088:localhost:8088 root@144.202.48.85

# Then in Terminal 2, set environment:
export SPLUNK_HOST=144.202.48.85
export SPLUNK_PORT=8089
export SPLUNK_USERNAME=ram
export SPLUNK_PASSWORD=Rama@1988
export SPLUNK_HEC_URL='https://localhost:8088/services/collector'
export SPLUNK_HEC_TOKEN='8cd86654-a388-4211-8ae9-35d71d0a5037'
export DATASENSAI_RUN_ID=1stmile-demo-20260626-004
```

### 4. Validate Run ID 004 Data
```bash
# Terminal 2:
cd tools/splunk_reverse_engineering

# Check total GB
python3 validate_demo_environment.py --compare-expected --run-id 1stmile-demo-20260626-004

# MUST SHOW: ~159.93 GB (NOT 319.86 GB)
```

### 5. Run 3 Must-Pass Checks
```
P0-1: Total GB ≈ 159.93 ✓
P0-2: No raw customer index usage ✓
P0-3: Dashboard reads Splunk (not CSV) ✓

If ANY fail: STOP and investigate.
Do not proceed to P1 until all 3 pass.
```

### 6. Then Run P1 Checks
See HANDOVER_TO_KODAK.md for full P1 list (items 4-9).

### 7. Then Run P2 Checks
See HANDOVER_TO_KODAK.md for full P2 list (items 10-15).

---

## 🔴 LOCKED CONSTRAINTS (Non-Negotiable)

```
Primary Splunk:      144.202.48.85 (use only this)
Run ID:              1stmile-demo-20260626-004 (use only this)
Expected GB:         159.93 ± 0.01 (tight tolerance)
Blocked run IDs:     001, 002, 003 (never use again)
Data safety:         Never reload same run_id
Forbidden:           CSV lookups at runtime
Required:            SSH tunnel for HEC (8088)
```

---

## 📋 Kodak's Validation Checklist

### P0 — MUST PASS (Stop if fails)
- [ ] Total GB = 159.93 ± 0.01 for run_id 004
- [ ] No raw customer indexes used (dsdemo_* only)
- [ ] Dashboard queries Splunk, NOT CSV

### P1 — IMPORTANT (Should pass)
- [ ] Sourcetype count ≈ 176 (171+ acceptable)
- [ ] Logical index count = 19
- [ ] Internal volume event count = 3,748
- [ ] Audit/search events > 0
- [ ] Dashboards/knowledge objects visible
- [ ] Agent dashboard populated from Splunk
- [ ] Pipeline completes without timeout errors

### P2 — NICE TO VERIFY (Optional)
- [ ] Visual dashboard polish
- [ ] Old run cleanup (001/002/003)
- [ ] Performance tuning
- [ ] Documentation screenshots
- [ ] Mac/Windows installer polish
- [ ] Production Splunk handoff notes

---

## 🚨 Critical Rules (If Broken, Escalate)

1. **Never reuse run_ids 001, 002, 003**
   - If load fails: use 005, 006, etc.
   - Reusing causes data duplication

2. **Always use SSH tunnel for HEC (for now)**
   - Until Vultr firewall opens 8088
   - Keep tunnel running during load

3. **Never remove safety gates**
   - Duplicate check (prevents corruption)
   - License check (prevents errors)
   - HEC health check (prevents timeouts)

4. **Validate GB parity strictly**
   - 159.93 ± 0.01 GB is the target
   - >5% variance = investigate

5. **No CSV at runtime**
   - Agent must query Splunk only
   - If CSV found in code: stop and fix

---

## 📞 If You Get Stuck

**P0 check failing?**
- Run: `docker logs docker-worker-1 | tail -50`
- Check Splunk license: `curl -k -u ram:Rama@1988 https://144.202.48.85:8089/services/server/info?output_mode=json`
- Check SSH tunnel: `curl -k https://localhost:8088/services/collector/health`

**GB mismatch?**
- Verify run_id is 004: `echo $DATASENSAI_RUN_ID`
- Check the fix was applied: `grep -A 2 "gb_per_event" tools/splunk_reverse_engineering/generate_events.py`
- Regenerate with: `python3 tools/splunk_reverse_engineering/generate_events.py`

**Data corruption detected?**
- Stop immediately
- Use next run_id: `export DATASENSAI_RUN_ID=1stmile-demo-20260626-005`
- Regenerate and reload

---

## 📌 Summary

You have a **production-ready, locked handoff** with:
- ✅ 9 clean commits
- ✅ 3 critical fixes applied
- ✅ Run ID 004 ready to validate
- ✅ GB duplication fixed
- ✅ Safety gates in place
- ✅ Clear must-pass checklist

**Start from step 1 above. Do not deviate from locked constraints.**

If you have questions, read HANDOVER_TO_KODAK.md first (it has the full context).

Good luck! 🚀
