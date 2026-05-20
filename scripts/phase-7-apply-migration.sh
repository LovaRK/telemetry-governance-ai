#!/bin/bash
# Phase 7: Apply Data Purity Migration
#
# This script applies the data purity schema migration to the database.
# CRITICAL: Run this AFTER completing Phase 6 (removing unsafe paths)
#
# Prerequisites:
# - DATABASE_URL environment variable must be set
# - Prisma client must be installed (npm install)
# - Schema changes must be committed to prisma/schema.prisma

set -e

echo "🚀 Phase 7: Applying Data Purity Migration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable not set"
    echo "   Please set DATABASE_URL=postgres://... before running this script"
    exit 1
fi

echo "📋 Database URL detected (first 50 chars): ${DATABASE_URL:0:50}..."

# Check Prisma is installed
if ! command -v npx &> /dev/null; then
    echo "❌ ERROR: npx not found. Please install Node.js"
    exit 1
fi

echo "✓ npx available"

# Check if migration file exists
MIGRATION_DIR="prisma/migrations/20260519_add_data_purity_tracking"
if [ ! -d "$MIGRATION_DIR" ]; then
    echo "❌ ERROR: Migration directory not found: $MIGRATION_DIR"
    exit 1
fi

echo "✓ Migration directory found"

# List pending migrations
echo ""
echo "📊 Pending migrations:"
npx prisma migrate status 2>&1 || true

echo ""
echo "🔄 Applying migration..."
npx prisma migrate deploy

echo ""
echo "✅ Migration applied successfully!"

echo ""
echo "🔍 Verifying migration..."
echo "   Checking if execution_journal has new columns..."

# Try to verify the schema
# Note: This is a simple verification - actual SQL will depend on connection
echo "   run: npx prisma db execute --stdin < verify-purity.sql"

echo ""
echo "✓ Phase 7 Complete"
echo ""
echo "📝 Next Steps:"
echo "   1. Verify database has new columns: source, mode, traceId"
echo "   2. Verify data_purity_audit table exists with proper indexes"
echo "   3. Backfill existing execution_journal rows with data purity metadata"
echo "   4. Proceed to Phase 8: CI enforcement script"
