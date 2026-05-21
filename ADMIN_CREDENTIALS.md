# Admin Credentials - Setup & Configuration

## Problem (Solved)
Login credentials were failing on every Docker deployment because no admin user was being created automatically. Users would see "Invalid credentials" even though they had valid credentials hardcoded in tests.

## Solution
Added an **automatic admin initialization script** that runs after database migrations on first Docker startup.

## How It Works

### Default Setup
```bash
docker-compose up
```

Logs will show:
```
[Admin Init] Login with:
  Email: admin@bitso.com
  Password: Admin@12345
```

**Login at:** `http://localhost:3002/login`

### Custom Credentials
Override the default credentials via environment variables:

```bash
ADMIN_EMAIL="your-email@company.com" \
ADMIN_PASSWORD="YourSecurePassword" \
docker-compose up
```

Or set in `.env` file:
```env
ADMIN_EMAIL=your-email@company.com
ADMIN_PASSWORD=YourSecurePassword123
```

Then:
```bash
docker-compose up
```

## Technical Details

### What Happens on Startup
1. **Migrations run** — Creates schema (users, tenants, etc.)
2. **init-admin.js runs** — Creates default tenant + admin user
3. **Schema validation** — Verifies all tables/columns exist
4. **Server starts** — Ready to accept login requests

### Idempotent Design
The initialization script checks if tenants already exist:
- **First startup**: Creates tenant + admin user
- **Subsequent startups**: Skips initialization (no action needed)
- **Manual user creation**: If users exist, script doesn't recreate them

### Security
- Password hashed with bcryptjs (10 salt rounds)
- Unique constraint on (tenant_id, email) prevents duplicates
- Account lockout after 5 failed attempts
- Token-based authentication with JWT + refresh tokens

## File Locations
- Initialization script: `scripts/init-admin.js`
- Docker entrypoint: `docker/entrypoint.sh` (calls init-admin.js)
- Configuration: `docker/docker-compose.yml` (env vars)
- Example settings: `.env.example`

## Troubleshooting

### "Invalid credentials" persists
Check logs for initialization:
```bash
docker-compose logs web | grep "Admin Init"
```

If init-admin failed, check:
1. Database is healthy: `docker-compose logs postgres`
2. Migrations completed: `docker-compose logs web | grep Migration`
3. Password is at least 8 characters

### Need to recreate admin user
Delete the database volume and restart:
```bash
docker-compose down
docker volume rm docker_postgres_data
docker-compose up
```

### Custom credential not working
1. Verify env var is set: `echo $ADMIN_EMAIL`
2. Restart services: `docker-compose down && docker-compose up`
3. Check password is at least 8 characters

## What Changed

### Created Files
- `scripts/init-admin.js` — Automatic admin user initialization
- `.env.example` — Configuration template
- `ADMIN_CREDENTIALS.md` — This file

### Modified Files
- `docker/entrypoint.sh` — Calls init-admin.js after migrations
- `docker/docker-compose.yml` — Added ADMIN_EMAIL and ADMIN_PASSWORD env vars

## Testing
```bash
# Test with default credentials
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@bitso.com", "password": "Admin@12345"}'

# Response should be 200 with access token (not 401)
```

---

**Bottom line:** No more "Invalid credentials" on Docker startup. Credentials are automatically created and configurable via environment variables.
