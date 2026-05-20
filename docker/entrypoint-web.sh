#!/bin/sh
# Web container entrypoint - run Next.js dev server

set -e

echo "Starting Next.js dev server on port 3000..."
echo "Working directory: $(pwd)"

# Change to web app directory and start Next.js dev server
cd /app/apps/web
exec /app/node_modules/.bin/next dev -p 3000
