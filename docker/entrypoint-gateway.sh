#!/bin/sh
# NGINX Gateway entrypoint - substitute env vars in config template

set -e

# Default values
GATEWAY_PORT=${GATEWAY_PORT:-80}
GATEWAY_HOST=${GATEWAY_HOST:-0.0.0.0}
API_UPSTREAM=${API_UPSTREAM:-web:3000}
API_CONNECT_TIMEOUT=${API_CONNECT_TIMEOUT:-5s}
API_SEND_TIMEOUT=${API_SEND_TIMEOUT:-10s}
API_READ_TIMEOUT=${API_READ_TIMEOUT:-10s}
WEB_UPSTREAM=${WEB_UPSTREAM:-web:3000}
WEB_CONNECT_TIMEOUT=${WEB_CONNECT_TIMEOUT:-5s}
WEB_SEND_TIMEOUT=${WEB_SEND_TIMEOUT:-10s}
WEB_READ_TIMEOUT=${WEB_READ_TIMEOUT:-10s}
SECURITY_FRAME_OPTIONS=${SECURITY_FRAME_OPTIONS:-SAMEORIGIN}
SECURITY_CONTENT_TYPE_OPTIONS=${SECURITY_CONTENT_TYPE_OPTIONS:-nosniff}
SECURITY_XSS_PROTECTION=${SECURITY_XSS_PROTECTION:-1; mode=block}

echo "Substituting NGINX environment variables..."
echo "  GATEWAY_PORT=$GATEWAY_PORT"
echo "  API_UPSTREAM=$API_UPSTREAM"
echo "  WEB_UPSTREAM=$WEB_UPSTREAM"

# Substitute vars in config template
# Note: placeholders use shell parameter expansion format like ${VAR:-default}
cat /etc/nginx/nginx.conf.template | \
  sed "s|\${GATEWAY_PORT:-[^}]*}|${GATEWAY_PORT}|g" | \
  sed "s|\${GATEWAY_HOST:-[^}]*}|${GATEWAY_HOST}|g" | \
  sed "s|\${API_UPSTREAM:-[^}]*}|${API_UPSTREAM}|g" | \
  sed "s|\${API_CONNECT_TIMEOUT:-[^}]*}|${API_CONNECT_TIMEOUT}|g" | \
  sed "s|\${API_SEND_TIMEOUT:-[^}]*}|${API_SEND_TIMEOUT}|g" | \
  sed "s|\${API_READ_TIMEOUT:-[^}]*}|${API_READ_TIMEOUT}|g" | \
  sed "s|\${WEB_UPSTREAM:-[^}]*}|${WEB_UPSTREAM}|g" | \
  sed "s|\${WEB_CONNECT_TIMEOUT:-[^}]*}|${WEB_CONNECT_TIMEOUT}|g" | \
  sed "s|\${WEB_SEND_TIMEOUT:-[^}]*}|${WEB_SEND_TIMEOUT}|g" | \
  sed "s|\${WEB_READ_TIMEOUT:-[^}]*}|${WEB_READ_TIMEOUT}|g" | \
  sed "s|\${SECURITY_FRAME_OPTIONS:-[^}]*}|${SECURITY_FRAME_OPTIONS}|g" | \
  sed "s|\${SECURITY_CONTENT_TYPE_OPTIONS:-[^}]*}|${SECURITY_CONTENT_TYPE_OPTIONS}|g" | \
  sed "s|\${SECURITY_XSS_PROTECTION:-[^}]*}|${SECURITY_XSS_PROTECTION}|g" \
  > /etc/nginx/nginx.conf

echo "NGINX configuration substituted successfully"

# Validate NGINX config
nginx -t

# Start NGINX
echo "Starting NGINX..."
exec "$@"
