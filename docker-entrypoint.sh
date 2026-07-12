#!/bin/sh
set -e

mkdir -p /app/data

if [ "$(id -u)" = "0" ]; then
  if [ -n "$PUID" ] && [ -n "$PGID" ]; then
    chown -R "${PUID}:${PGID}" /app/data
    exec su-exec "${PUID}:${PGID}" "$@"
  fi
  chown -R node:node /app/data
  exec su-exec node "$@"
fi

exec "$@"
