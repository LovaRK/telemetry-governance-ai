# Complete Step-by-Step Installation Guide

## 🎯 Goal
Run the datasensAI Governance Platform locally and access the dashboard at http://localhost:3002

---

## 📋 Prerequisites Check (5 minutes)

### Step 1: Verify Node.js Installation

```bash
node --version
# Should output: v18.0.0 or higher

npm --version
# Should output: 9.0.0 or higher
```

**If Node.js is NOT installed:**
- Download from: https://nodejs.org/ (LTS version)
- Install it
- Restart your terminal
- Run the version commands again

### Step 2: Verify Docker Installation

```bash
docker --version
# Should output: Docker version 20.0 or higher

docker ps
# Should show: CONTAINER ID   IMAGE   COMMAND...
# (It may show no containers, which is fine)
```

**If Docker is NOT installed:**
- **Mac**: Download from https://www.docker.com/products/docker-desktop
- **Windows**: Download from https://www.docker.com/products/docker-desktop
- **Linux**: Run: `sudo apt-get install docker.io`
- **Start Docker**: 
  - Mac: Open `/Applications/Docker.app`
  - Linux: `sudo systemctl start docker`
- Wait 30 seconds for Docker daemon to start
- Run `docker ps` to verify

### Step 3: Start Docker Daemon

**Mac Users:**
```bash
open /Applications/Docker.app
# Wait 30 seconds for Docker to start
# You'll see the Docker icon in the top menu bar
```

**Linux Users:**
```bash
sudo systemctl start docker
```

**Verify Docker is running:**
```bash
docker ps
# Should NOT show "Cannot connect to Docker daemon" error
```

---

## 🚀 Installation Steps (10 minutes)

### Step 4: Navigate to Project Directory

```bash
cd /Users/ramakrishna/Desktop/Teja/Dashboards
# Or wherever you have the project folder
```

Verify you're in the right location:
```bash
ls
# Should show: package.json, docker-compose.yml, README.md, apps/, etc.
```

### Step 5: Install Dependencies

```bash
npm install
# This will take 2-3 minutes
# You'll see: "added X packages" at the end
```

**What this does:**
- Downloads all Node.js packages
- Installs bullmq, redis, uuid, typescript, etc.
- Creates `node_modules/` folder

### Step 6: Install Playwright (for E2E tests)

```bash
npx playwright install
# This will take 2-3 minutes
# Downloads browser engines (Chromium, Firefox, WebKit)
```

**Optional** (for E2E tests):
```bash
npm install --save-dev @playwright/test
```

### Step 7: Start All Services

This is the **MAIN COMMAND** that runs everything:

```bash
npm run dev
```

**What happens:**
- Docker starts PostgreSQL container
- Docker starts Redis container
- Node.js API server starts on port 3001
- Next.js web app starts on port 3002
- You'll see output like:

```
> agentic-telemetry-dashboard@1.0.0 dev
> docker-compose -f docker/docker-compose.yml up

Creating network "docker_default" with the default driver
Creating docker-postgres-1 ... done
Creating docker-redis-1 ... done
Creating docker-api-1 ... done
Creating docker-web-1 ... done

✓ PostgreSQL ready on 0.0.0.0:5433
✓ Redis ready on 0.0.0.0:6379
✓ API ready on 0.0.0.0:3001
✓ Web app ready on 0.0.0.0:3002

All services ready!
```

**WAIT** for the "All services ready!" message (takes ~30-60 seconds)

---

## 🌐 Access the Application (1 minute)

### Step 8: Open Dashboard

Once you see "All services ready!", open your browser:

```
http://localhost:3002
```

**You should see:**
- A dark blue dashboard with "datasensAI" logo
- A "Connect to Splunk to get started" message
- A connection form with fields for:
  - Splunk URL
  - Authentication type (Basic or Token)
  - Username/Password or API Token

### Step 9: Verify All Services Are Running

**In a NEW terminal** (keep the first one with `npm run dev` running):

```bash
# Check API is responding
curl http://localhost:3001/health
# Should return: {"status":"healthy"}

# Check web app is responding
curl http://localhost:3002
# Should return: HTML with datasensAI

# Check PostgreSQL is running
docker ps | grep postgres
# Should show a running container

# Check Redis is running
redis-cli -p 6379 ping
# Should return: PONG
```

---

## ✅ Complete Setup Checklist

After following all steps above, verify:

- [ ] Node.js installed (`node --version` shows v18+)
- [ ] Docker installed and running (`docker ps` works)
- [ ] Dependencies installed (`npm install` completed)
- [ ] Playwright installed (`npx playwright install` completed)
- [ ] Services running (`npm run dev` shows "All services ready!")
- [ ] Dashboard accessible (http://localhost:3002 loads)
- [ ] API healthy (`curl http://localhost:3001/health` returns status)
- [ ] Redis working (`redis-cli ping` returns PONG)

---

## 🧪 Optional: Run Tests (10 minutes)

**Keep `npm run dev` running in Terminal 1**

**In a NEW Terminal 2:**

### Run Chaos Tests
```bash
npm run test:chaos
# Should show: ✓ 16 tests passed
```

### Run E2E Tests
```bash
npm run test:e2e
# Should show: ✓ 12 tests passed
```

---

## 🔌 Connect to Splunk (Optional)

Once the dashboard is running at http://localhost:3002:

1. Get your Splunk instance URL (e.g., `https://splunk.company.com:8089`)
2. Get your credentials (username/password or API token)
3. In the dashboard form, enter:
   - **Splunk URL**: Your Splunk instance URL
   - **Auth Type**: Choose "Basic Auth" or "Token"
   - **Username/Password**: Your credentials
   - **Skip SSL verification**: Check if self-signed cert
4. Click "Connect & Refresh"
5. Wait 2-5 minutes for LLM pipeline
6. See results on dashboard

---

## 📋 Command Summary

Here's a quick reference of all commands in order:

```bash
# 1. Navigate to project
cd /Users/ramakrishna/Desktop/Teja/Dashboards

# 2. Verify prerequisites
node --version     # v18+
docker --version   # Docker 20+

# 3. Start Docker (Mac)
open /Applications/Docker.app
# Or (Linux)
sudo systemctl start docker

# 4. Install dependencies
npm install

# 5. Install Playwright
npx playwright install

# 6. Start all services (MAIN COMMAND)
npm run dev

# 7. Open dashboard (in browser)
# http://localhost:3002

# 8. Verify services (in another terminal)
curl http://localhost:3001/health
curl http://localhost:3002
redis-cli ping

# 9. Run tests (optional, in another terminal)
npm run test:chaos
npm run test:e2e
```

---

## 🛑 Troubleshooting

### Problem: Docker daemon not running
```bash
# Mac
open /Applications/Docker.app
# Wait 30 seconds
docker ps

# Linux
sudo systemctl start docker
docker ps
```

### Problem: Port 3002 already in use
```bash
# Find what's using the port
lsof -i :3002

# Kill the process (replace PID)
kill -9 <PID>

# Try again
npm run dev
```

### Problem: npm install fails
```bash
# Clear cache
npm cache clean --force

# Delete node_modules
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

### Problem: Docker containers won't start
```bash
# Stop and remove old containers
npm run clean
# or
docker-compose -f docker/docker-compose.yml down -v

# Try again
npm run dev
```

### Problem: Redis connection error
```bash
# Check if container is running
docker ps | grep redis

# Check logs
docker logs docker-redis-1

# Restart
npm run clean
npm run dev
```

---

## 📊 What Each Command Does

| Command | What It Does | Duration |
|---------|-------------|----------|
| `npm install` | Downloads all dependencies | 2-3 min |
| `npx playwright install` | Downloads browser engines | 2-3 min |
| `npm run dev` | Starts Docker containers + services | 30-60 sec |
| `npm run test:chaos` | Runs 16 integration tests | 30 sec |
| `npm run test:e2e` | Runs 12 UI tests | 13 sec |
| `curl http://localhost:3002` | Tests web app | instant |

---

## 🎯 Expected Output at Each Stage

### After `npm install`:
```
added 400+ packages in 2m30s
```

### After `npm run dev`:
```
✓ PostgreSQL ready on 0.0.0.0:5433
✓ Redis ready on 0.0.0.0:6379
✓ API ready on 0.0.0.0:3001
✓ Web app ready on 0.0.0.0:3002
All services ready!
```

### After accessing http://localhost:3002:
```
[Shows datasensAI dashboard]
[Shows "Connect to Splunk to get started" form]
```

### After `npm run test:chaos`:
```
Test Files  4 passed (4)
Tests      16 passed (16)
Duration   ~30s
```

---

## ✨ Next Steps

1. **Dashboard Running?** → Go to http://localhost:3002 ✅
2. **Want to connect Splunk?** → Use the connection form ✅
3. **Want to run tests?** → Use `npm run test:e2e` ✅
4. **Want to understand system?** → Read SOURCE_OF_TRUTH.md ✅
5. **Want to stop services?** → Press `Ctrl+C` in terminal, then `npm run clean` ✅

---

## 📞 Need Help?

- **Services won't start?** → Check "Troubleshooting" section above
- **Port conflicts?** → Change port: `PORT=3003 npm run dev`
- **Docker issues?** → Make sure Docker Desktop is open (Mac)
- **Tests failing?** → Run `npm run test:e2e:debug` to see what's wrong
- **Still stuck?** → Check `RUN_LOCALLY.md` for more details

---

**✅ You're Ready!** 

Follow the steps above and you'll have a fully functional governance platform running locally.

**Estimated Total Time: 15-20 minutes**

Good luck! 🚀
