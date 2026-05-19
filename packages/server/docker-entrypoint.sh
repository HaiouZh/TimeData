#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R timedata:timedata /app/data 2>/dev/null || true
  exec su-exec timedata "$0" "$@"
fi

exec "$@"
