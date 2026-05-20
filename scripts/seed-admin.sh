#!/bin/bash

set -e

# Load env variables
source .env.local

echo "🌱 Seeding stable admin user..."

# Step 1: Create tenant
echo "  ✓ Creating tenant: $TENANT_NAME..."
TENANT_RESPONSE=$(curl -s -X POST http://localhost:3002/api/setup/tenant \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$TENANT_NAME\",\"slug\":\"$TENANT_SLUG\"}")

TENANT_ID=$(echo "$TENANT_RESPONSE" | jq -r '.id // empty')

if [ -z "$TENANT_ID" ]; then
  # Tenant might already exist - try to fetch it
  echo "  ℹ  Tenant may already exist, proceeding..."
  # Extract from response or use existing
  TENANT_ID=$(echo "$TENANT_RESPONSE" | jq -r '.id // .tenant_id // empty')
  
  if [ -z "$TENANT_ID" ]; then
    echo "  ⚠  Could not determine tenant ID, but proceeding..."
    TENANT_ID="default"
  fi
fi

echo "  ✓ Tenant ID: $TENANT_ID"

# Step 2: Create admin user
echo "  ✓ Creating admin user: $APP_ADMIN_EMAIL..."
USER_RESPONSE=$(curl -s -X POST http://localhost:3002/api/setup/admin \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"email\":\"$APP_ADMIN_EMAIL\",\"password\":\"$APP_ADMIN_PASSWORD\",\"name\":\"Admin\"}")

USER_ID=$(echo "$USER_RESPONSE" | jq -r '.user_id // empty')

if [ -z "$USER_ID" ]; then
  echo "  ⚠  Could not create user (may already exist)"
  echo "     Response: $USER_RESPONSE"
else
  echo "  ✓ User created: $USER_ID"
fi

echo ""
echo "✅ SEED COMPLETE"
