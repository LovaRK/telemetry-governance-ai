# Safe Docker Cleanup Runbook

**Purpose:** Safely clean up Docker resources on production without risking data loss  
**Audience:** DevOps, Site Reliability Engineers  
**Last Updated:** 2026-05-20

---

## ⚠️ CRITICAL: DO NOT RUN ON PRODUCTION

```bash
# ❌ FORBIDDEN - can delete production volumes
docker system prune -a -f --volumes
docker volume prune -a -f
```

These commands remove **unused** volumes. In production, a volume can become "unused" if:
- Its container is stopped (but not deleted)
- A migration script added a new container but forgot the old one
- A developer or runbook misidentified a dependency

This kills production databases, backups, and Splunk data instantly.

---

## Pre-Cleanup Checklist

### Step 1: Audit Current State

Run these commands and **save the output** (in case you need to recover):

```bash
# What do we have?
echo "=== CONTAINERS ===" > pre_cleanup_audit.txt
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Mounts}}" >> pre_cleanup_audit.txt

echo -e "\n=== VOLUMES ===" >> pre_cleanup_audit.txt
docker volume ls >> pre_cleanup_audit.txt

echo -e "\n=== DISK USAGE ===" >> pre_cleanup_audit.txt
docker system df -v >> pre_cleanup_audit.txt

# Review what you found
cat pre_cleanup_audit.txt
```

### Step 2: Backup Production Databases

```bash
# Postgres
docker-compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U telemetry -d telemetry_os \
  > telemetry_os_backup_$(date +%F_%H%M%S).sql

# Verify backup is valid
ls -lh telemetry_os_backup_*.sql
file telemetry_os_backup_*.sql
head -20 telemetry_os_backup_*.sql | grep -i "postgresql\|dump"

# If Splunk runs in Docker
docker logs splunk 2>&1 | head -20
# Or if host-installed
ls -lah /opt/splunk/var/lib/splunk/
```

### Step 3: Identify What's Safe to Delete

```bash
# Read the audit above and identify:
# - Containers that are Exited and not referenced by compose
# - Volumes that are not mounted by any container
# - Old images that are unused

# Example: test-redis is Exited and not in docker-compose.yml
# But before you delete it, check:
docker inspect test-redis | grep -A5 "Mounts"
# If Mounts is empty and no other container uses it, it's safe
```

### Step 4: Identify What to KEEP

```bash
# Check what docker-compose.yml actually uses
grep -r "volumes:" docker/docker-compose.yml
docker-compose -f docker/docker-compose.yml config | grep -A10 "volumes:"

# For postgres specifically
docker inspect docker_postgres_data
# Look for: "Containers" field - if it lists docker-postgres-1, KEEP this volume
```

---

## Safe Cleanup Operations

### Option 1: Remove Images Only (Always Safe)

```bash
# Remove dangling images (unused layers)
docker image prune -f

# Remove all unused images (safe if not in production)
docker image prune -a -f
```

**Why safe:** Images can be rebuilt from Dockerfile. No data loss.

### Option 2: Remove Build Cache (Always Safe)

```bash
docker builder prune -f
```

**Why safe:** Rebuilding takes longer but works fine. No data loss.

### Option 3: Clean Logs (Always Safe)

```bash
# Remove journal logs older than 30 days
journalctl --vacuum-time=30d

# Remove journal logs over 500MB
journalctl --vacuum-size=500M
```

**Why safe:** Only removes logs, not application data.

### Option 4: Minimal System Cleanup (Mostly Safe)

```bash
# Remove unused containers and images, but NOT volumes
docker system prune -f

# Note: -a (remove all) and --volumes (remove volumes) are NOT included
# This is safe because:
# - Removes exited containers (can be recreated from images)
# - Removes unused images (can be rebuilt)
# - Leaves ALL volumes untouched
```

**Why safe:** Volumes are preserved even if containers are removed.

### Option 5: Selective Volume Removal (REQUIRES VERIFICATION)

Only use if you have verified each volume is truly unused:

```bash
# List all volumes
docker volume ls

# For each volume you want to remove:
docker inspect <volume_name>

# Look at the "Containers" field
# If it's empty or all containers are Exited, AND you've backed up, then:
docker volume rm <volume_name>

# Example: Remove test-redis volume if test-redis container is Exited
docker volume rm test-redis-volume
```

**Why risky:** Easy to delete the wrong volume. Always back up first.

---

## Recommended Safe Cleanup Script

Save this as `safe_cleanup.sh`:

```bash
#!/bin/bash
set -e

echo "=== SAFE DOCKER CLEANUP ==="
echo "This script is safe for production."
echo ""

# 1. Backup databases
echo "Step 1: Backing up databases..."
docker-compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U telemetry -d telemetry_os \
  > telemetry_os_backup_$(date +%F_%H%M%S).sql
echo "✅ Backup created"

# 2. Check volumes (informational)
echo ""
echo "Step 2: Current volumes (for reference)..."
docker volume ls

# 3. Clean images
echo ""
echo "Step 3: Removing unused images..."
docker image prune -a -f
echo "✅ Images cleaned"

# 4. Clean build cache
echo ""
echo "Step 4: Removing build cache..."
docker builder prune -f
echo "✅ Build cache cleaned"

# 5. Clean logs
echo ""
echo "Step 5: Cleaning system logs..."
journalctl --vacuum-size=500M
echo "✅ Logs cleaned"

# 6. Clean containers only (NO VOLUMES)
echo ""
echo "Step 6: Removing unused containers..."
docker system prune -f
echo "✅ Containers cleaned (volumes preserved)"

# 7. Final state
echo ""
echo "=== CLEANUP COMPLETE ==="
echo ""
echo "Current state:"
docker system df
echo ""
echo "Backup files:"
ls -lh telemetry_os_backup_*.sql | tail -5
```

Make it executable:
```bash
chmod +x safe_cleanup.sh
./safe_cleanup.sh
```

---

## What Happens if Something Goes Wrong

### Scenario 1: Accidentally Deleted a Volume

```bash
# Check if backup exists
ls -lh telemetry_os_backup_*.sql

# If yes, restore it
docker-compose -f docker/docker-compose.yml exec -T postgres \
  psql -U telemetry < telemetry_os_backup_2026-05-20_1234.sql

# Verify restoration
docker-compose -f docker/docker-compose.yml exec -T postgres \
  psql -U telemetry -d telemetry_os -c "SELECT COUNT(*) FROM tenants;"
```

### Scenario 2: Accidentally Deleted a Container

```bash
# If the container is in docker-compose.yml, just recreate it
docker-compose -f docker/docker-compose.yml up -d postgres

# The volume was preserved, so data is intact
```

### Scenario 3: Ran Dangerous Command

```bash
# If you ran: docker system prune -a -f --volumes

# Check what's left
docker volume ls
docker ps -a

# If critical volumes are gone:
# 1. Check backup location: ls -lh telemetry_os_backup_*.sql
# 2. If backup exists, restore (see Scenario 1)
# 3. If no backup: escalate to management (data recovery needed)
```

---

## Monitoring & Maintenance

### Weekly Task

```bash
# Check disk usage
docker system df

# If over 80% full, run safe_cleanup.sh
# If under 80%, do nothing
```

### Monthly Task

```bash
# List all volumes and containers
docker volume ls > monthly_volumes_$(date +%F).txt
docker ps -a > monthly_containers_$(date +%F).txt

# Archive backups
mkdir -p backups/$(date +%Y-%m)
mv telemetry_os_backup_*.sql backups/$(date +%Y-%m)/

# Verify backups are readable
head -20 backups/$(date +%Y-%m)/telemetry_os_backup_*.sql | grep -i postgresql
```

### Quarterly Task

```bash
# Test restore procedure (in staging, not production!)
pg_dump -U telemetry -d telemetry_os > test_backup_$(date +%F).sql
# Verify it works:
psql -U telemetry < test_backup_$(date +%F).sql
```

---

## Summary Table

| Operation | Risk | Data Loss? | When Safe |
|-----------|------|-----------|-----------|
| `image prune -a -f` | Low | No | Always |
| `builder prune -f` | Low | No | Always |
| `journalctl --vacuum-*` | Low | No (logs only) | Always |
| `system prune -f` | Low | No | Always |
| `system prune -a -f` | Medium | Maybe (if unused images needed) | After backup |
| `volume prune -f` | **HIGH** | **YES** | Never on production |
| `system prune -a -f --volumes` | **CRITICAL** | **YES** | **NEVER** |

---

## Approval Checklist

Before running ANY cleanup on production:

- [ ] Created backup: `ls -lh telemetry_os_backup_*.sql`
- [ ] Verified backup is non-empty: `file telemetry_os_backup_*.sql`
- [ ] Ran audit: `docker system df -v > pre_cleanup_audit.txt`
- [ ] Identified containers to keep
- [ ] Identified volumes to keep
- [ ] Documented deletion candidates
- [ ] Manager/team approval obtained
- [ ] Have rollback plan (restore from backup)
- [ ] NOT using: `--volumes`, `volume prune`, or `system prune -a -f --volumes`
- [ ] Using only: `image prune -a -f`, `builder prune -f`, `journalctl`, or `system prune -f`

---

**Version:** 1.0  
**Last Reviewed:** 2026-05-20  
**Maintainer:** DevOps Team  
**Incident Reference:** Docker system prune --volumes performed without backup on 2026-05-20 (fortunately, no data loss occurred because volumes remained attached)
