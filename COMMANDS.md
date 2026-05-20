# All Commands - Copy & Paste

## START THE SYSTEM

```bash
./scripts/check-ports.sh
npm run dev
```

**Access at:** http://localhost:3003

---

## RUN TESTS

```bash
npm run test:e2e
```

**Watch mode:**
```bash
npm run test:e2e:watch
```

**Interactive UI:**
```bash
npm run test:e2e:ui
```

**Debug:**
```bash
npm run test:e2e:debug
```

---

## STOP EVERYTHING

```bash
npm run stop
```

Or manually:
```bash
docker-compose -f docker/docker-compose.yml down
```

---

## VIEW LOGS

**NGINX Gateway:**
```bash
docker logs -f dashboard_gateway
```

**Web App:**
```bash
docker logs -f dashboard_web
```

**Database:**
```bash
docker logs -f dashboard_postgres
```

**Worker:**
```bash
docker logs -f dashboard_worker
```

**All services:**
```bash
docker-compose -f docker/docker-compose.yml logs -f
```

---

## VERIFY SYSTEM IS WORKING

**Gateway health:**
```bash
curl http://localhost:3003/health
```

**App health:**
```bash
curl http://localhost:3003/api/health
```

**Security headers:**
```bash
curl -i http://localhost:3003/
```

**Running containers:**
```bash
docker ps
```

---

## RESET DATABASE

```bash
docker volume rm dashboard_postgres_data
npm run dev
```

---

## USE DIFFERENT PORT

```bash
GATEWAY_PORT=8080 npm run dev
```

Access at: http://localhost:8080

---

## REBUILD NGINX IMAGE

```bash
docker build -f docker/Dockerfile.nginx -t dashboard-nginx:latest .
npm run dev
```

---

## CLEAN UP EVERYTHING

```bash
docker-compose -f docker/docker-compose.yml down -v
docker volume rm dashboard_postgres_data
docker image rm dashboard-nginx dashboard-web dashboard-worker
```

---

## BUILD SPECIFIC SERVICE

**Web:**
```bash
docker build -f docker/Dockerfile.web -t dashboard-web:latest .
```

**Worker:**
```bash
docker build -f docker/Dockerfile.worker -t dashboard-worker:latest .
```

**NGINX:**
```bash
docker build -f docker/Dockerfile.nginx -t dashboard-nginx:latest .
```

---

## SHELL INTO CONTAINER

**Web:**
```bash
docker exec -it dashboard_web /bin/sh
```

**NGINX:**
```bash
docker exec -it dashboard_gateway /bin/sh
```

**Database:**
```bash
docker exec -it dashboard_postgres psql -U telemetry -d telemetry_os
```

---

## DATABASE OPERATIONS

**Connect to database:**
```bash
docker exec -it dashboard_postgres psql -U telemetry -d telemetry_os
```

**View all tables:**
```bash
docker exec -it dashboard_postgres psql -U telemetry -d telemetry_os -c "\dt"
```

**Backup database:**
```bash
docker exec dashboard_postgres pg_dump -U telemetry -d telemetry_os > backup.sql
```

**Restore database:**
```bash
docker exec -i dashboard_postgres psql -U telemetry -d telemetry_os < backup.sql
```

---

## NGINX CONFIG VALIDATION

```bash
docker exec dashboard_gateway nginx -t
```

**View current config:**
```bash
docker exec dashboard_gateway cat /etc/nginx/nginx.conf
```

---

## CHECK PORT AVAILABILITY

```bash
lsof -i :3003
```

**Find process using port and kill it:**
```bash
kill -9 $(lsof -i :3003 -t)
```

---

## ENVIRONMENT VARIABLES

**Check gateway port:**
```bash
echo $GATEWAY_PORT
```

**Check node env:**
```bash
echo $NODE_ENV
```

**Load from .env.development:**
```bash
set -a; source .env.development; set +a
```

---

## CI/CD OVERRIDE

**Use CI environment:**
```bash
CI=true npm run test:e2e
```

**Override with custom gateway port:**
```bash
GATEWAY_PORT=9000 npm run dev
```

---

## RESTART SERVICES

**Restart everything:**
```bash
docker-compose -f docker/docker-compose.yml restart
```

**Restart specific service:**
```bash
docker-compose -f docker/docker-compose.yml restart web
```

---

## VIEW RUNNING PROCESSES

**All containers:**
```bash
docker ps
```

**All containers including stopped:**
```bash
docker ps -a
```

**Container resource usage:**
```bash
docker stats
```

---

## NETWORK INSPECTION

**List networks:**
```bash
docker network ls
```

**Inspect network:**
```bash
docker network inspect dashboard_network
```

---

## HEALTH CHECK TESTS

**Check gateway health endpoint:**
```bash
curl http://localhost:3003/health | jq
```

**Check app health through gateway:**
```bash
curl http://localhost:3003/api/health | jq
```

**Check if services are ready:**
```bash
curl http://localhost:3003/health/ready
```

---

## DEVELOPMENT WORKFLOW

**1. Start system:**
```bash
npm run dev
```

**2. In another terminal, run tests:**
```bash
npm run test:e2e:watch
```

**3. Edit code (auto-reload in web container)**

**4. Tests re-run automatically**

**5. Stop when done:**
```bash
npm run stop
```

---

## PERFORMANCE MONITORING

**View container stats:**
```bash
docker stats dashboard_gateway dashboard_web dashboard_postgres
```

**View NGINX request log:**
```bash
docker exec dashboard_gateway tail -f /var/log/nginx/access.log
```

**View error log:**
```bash
docker exec dashboard_gateway tail -f /var/log/nginx/error.log
```

---

## TROUBLESHOOTING QUICK COMMANDS

**Port already in use:**
```bash
lsof -i :3003
kill -9 <PID>
```

**Gateway won't start:**
```bash
docker logs dashboard_gateway
```

**Web app won't start:**
```bash
docker logs dashboard_web
```

**Tests fail with 504:**
```bash
docker logs dashboard_web | tail -20
```

**Check if NGINX config is valid:**
```bash
docker build -f docker/Dockerfile.nginx -t test:latest .
```

---

## COMPLETE FRESH START

```bash
# Kill any running containers
docker-compose -f docker/docker-compose.yml down -v

# Remove volumes
docker volume rm dashboard_postgres_data

# Rebuild everything
docker-compose -f docker/docker-compose.yml build

# Start fresh
npm run dev
```

---

## ONE-LINER COMMANDS

**Start and wait for health:**
```bash
npm run dev && sleep 15 && curl http://localhost:3003/health
```

**Run tests immediately:**
```bash
npm run dev && sleep 20 && npm run test:e2e
```

**Full cycle (start, test, stop):**
```bash
npm run dev & sleep 20 && npm run test:e2e && npm run stop
```

---

## BACKGROUND MODE (Keep Running)

**Start in background:**
```bash
npm run dev &
```

**Bring to foreground:**
```bash
fg
```

**See background jobs:**
```bash
jobs
```

---

## COMPOSE DIRECT COMMANDS

**Start services:**
```bash
docker-compose -f docker/docker-compose.yml up -d
```

**Stop services:**
```bash
docker-compose -f docker/docker-compose.yml down
```

**View status:**
```bash
docker-compose -f docker/docker-compose.yml ps
```

**Pull latest images:**
```bash
docker-compose -f docker/docker-compose.yml pull
```

**Build services:**
```bash
docker-compose -f docker/docker-compose.yml build
```

---

## FILE OPERATIONS

**Check if .env.development exists:**
```bash
cat .env.development
```

**View docker-compose.yml:**
```bash
cat docker/docker-compose.yml
```

**View NGINX config:**
```bash
cat docker/nginx/nginx.conf
```

**View Playwright config:**
```bash
cat playwright.config.ts
```

---

## DATABASE QUICK QUERIES

**Count rows in a table:**
```bash
docker exec dashboard_postgres psql -U telemetry -d telemetry_os -c "SELECT COUNT(*) FROM agent_decisions;"
```

**List all tables:**
```bash
docker exec dashboard_postgres psql -U telemetry -d telemetry_os -c "\dt"
```

**Export table to CSV:**
```bash
docker exec dashboard_postgres psql -U telemetry -d telemetry_os -c "COPY agent_decisions TO STDOUT WITH CSV HEADER;" > agent_decisions.csv
```

---

## THAT'S IT

Just copy & paste any command above. No need to read - just run it.
