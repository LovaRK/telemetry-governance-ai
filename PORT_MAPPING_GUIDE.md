# Port Mapping Guide

## Current Setup

```
┌─────────────────────────────────────────┐
│         YOUR COMPUTER (HOST)            │
│                                         │
│  http://localhost:3002  ←──────────┐   │
│  http://localhost:5433  ←────┐     │   │
│  http://localhost:6379  ←──┐ │     │   │
└─────────────────────────────┼─┼─────┼───┘
                              │ │     │
                        ┌─────┘ │     │
                        │       │     │
┌───────────────────────┼───────┼─────┼───┐
│     DOCKER NETWORK    │       │     │   │
│                       │       │     │   │
│                  ┌────▼──┐   ▼─────┴──┐ │
│                  │ Web   │   │        │ │
│                  │ Port  │   │        │ │
│                  │ 3000  │   │  5432  │ │
│                  └───────┘   │        │ │
│                           Database    │ │
│                            Postgres   │ │
│                                       │ │
│                   ┌──────────────┐    │ │
│                   │ Redis        │    │ │
│                   │ Port 6379    │────┘ │
│                   └──────────────┘      │
└───────────────────────────────────────────┘

KEY:
- Web app: Inside Docker runs on 3000, exposed as 3002 on host
- Database: Inside Docker runs on 5432, exposed as 5433 on host  
- Redis: Inside Docker runs on 6379, exposed as 6379 on host
```

---

## Port Mapping Details

### Docker Compose Mapping (docker/docker-compose.yml)

```yaml
# Line 7: Web app port mapping
ports:
  - "3002:3000"     # HOST:CONTAINER
  # 3002 = port on your computer (localhost:3002)
  # 3000 = port inside Docker container

# Line 42-43: Database port mapping
ports:
  - "5433:5432"     # HOST:CONTAINER
  # 5433 = port on your computer
  # 5432 = port inside Docker container

# Redis is exposed as 6379:6379 (no mapping needed)
```

---

## What's Hard-Coded vs What's Configurable?

### ✅ CONFIGURABLE (Safe to change)

| File | What Can Change | Impact |
|------|-----------------|--------|
| `docker/docker-compose.yml` | `"3002:3000"` | Changes host port (change left side only) |
| `playwright.config.ts` | `baseURL: 'http://localhost:3002'` | Changes E2E test URL |
| Documentation files | Port references in .md | Just docs, no functional impact |

### ❌ HARD-CODED (Should NOT change)

Inside Docker containers, these ports are hard-coded in the application:

- Web app INSIDE Docker: **3000** (cannot change easily)
- Database INSIDE Docker: **5432** (cannot change easily)
- Redis INSIDE Docker: **6379** (cannot change easily)

These are application defaults and would require code changes to modify.

---

## Common Changes

### Change 1: Use Port 3005 on Your Computer Instead of 3002

**File: `docker/docker-compose.yml`**

Change this:
```yaml
# Line 6-7
ports:
  - "3002:3000"
```

To this:
```yaml
# Line 6-7
ports:
  - "3005:3000"
```

Then also update `playwright.config.ts`:

**File: `playwright.config.ts`**

Change this:
```typescript
baseURL: 'http://localhost:3002',
```

To this:
```typescript
baseURL: 'http://localhost:3005',
```

Then access your app at: **http://localhost:3005**

### Change 2: Change All Port References

If you want to use different ports completely:

1. **docker/docker-compose.yml** - Change left side of mapping
2. **playwright.config.ts** - Update baseURL
3. **.md files** - Update documentation (optional, doesn't affect functionality)

---

## What NOT to Change

### ❌ Never change the RIGHT side of the port mapping

```yaml
ports:
  - "3002:3000"
         ↑
    Don't change this (it's inside Docker)
```

Changing `3000` to something else requires:
- Modifying Next.js server startup code
- Rebuilding Docker image
- Not recommended unless you know what you're doing

### ❌ Never change database port inside Docker

```yaml
postgres:
  ports:
    - "5433:5432"
           ↑
      Don't change this
```

PostgreSQL expects port 5432 inside the container.

---

## Summary

| Question | Answer |
|----------|--------|
| **Inside Docker, web runs on...** | Port 3000 (fixed) |
| **On your computer, access web at...** | Port 3002 (configurable in docker-compose.yml) |
| **Inside Docker, database runs on...** | Port 5432 (fixed) |
| **On your computer, access database at...** | Port 5433 (configurable in docker-compose.yml) |
| **Can I change 3002 to 3005?** | ✅ Yes, just update docker-compose.yml |
| **Can I change 3000 to 3500?** | ❌ No, requires code changes |
| **Will changing port break other code?** | Only if you don't update playwright.config.ts |
| **Is port hard-coded anywhere else?** | ✅ Only in playwright.config.ts and .md docs |

---

## Complete Example: Switch from 3002 to 3005

**Step 1: Update docker-compose.yml**
```bash
# Open file and change line 7
nano docker/docker-compose.yml
```

Change:
```yaml
- "3002:3000"
```

To:
```yaml
- "3005:3000"
```

**Step 2: Update playwright.config.ts**
```bash
nano playwright.config.ts
```

Change:
```typescript
baseURL: 'http://localhost:3002',
```

To:
```typescript
baseURL: 'http://localhost:3005',
```

**Step 3: Restart services**
```bash
# Stop current services
npm run clean

# Start again
npm run dev
```

**Step 4: Access at new port**
```
http://localhost:3005
```

---

## Current References in Codebase

| File | Port Reference | Can Change? | Need to Change? |
|------|-----------------|-------------|-----------------|
| `docker/docker-compose.yml` | 3002 (host), 3000 (container) | Left side ✅ | If you want different host port |
| `playwright.config.ts` | 3002 | ✅ | If you change docker-compose.yml |
| `README.md` | 3000, 3002 | ✅ (docs only) | No (docs don't affect functionality) |
| `RUN_LOCALLY.md` | 3002 | ✅ (docs only) | No |
| `INSTALLATION_GUIDE.md` | 3002 | ✅ (docs only) | No |
| Application code | None! | N/A | N/A |

---

## Key Takeaway

✅ **The application code itself does NOT hard-code any ports**

Only these two files matter:
1. **docker-compose.yml** - Controls what port you access on your computer
2. **playwright.config.ts** - Tells E2E tests which port to use

Everything else is just documentation.

So you're safe! Change the left side of the mapping in docker-compose.yml whenever you want. 🎉
