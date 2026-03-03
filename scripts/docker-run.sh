#!/bin/bash
# Workaround for Docker Desktop v2.15.1 "extensions" bug.
# Builds and runs all Node services using docker build + docker run directly.
# Postgres and Redis should already be running via docker compose.
#
# Usage:
#   ./scripts/docker-run.sh build     # Build all images
#   ./scripts/docker-run.sh up        # Run all services (foreground)
#   ./scripts/docker-run.sh stop      # Stop all services

set -euo pipefail
cd "$(dirname "$0")/.."

SERVICES=(trend-detector token-launcher exit-manager telegram-bot)
NETWORK="flash-pump-engine_default"

case "${1:-help}" in
  build)
    for svc in "${SERVICES[@]}"; do
      echo "==> Building flash-pump/$svc"
      docker build --build-arg PACKAGE="$svc" -t "flash-pump/$svc" .
    done
    echo "==> All images built."
    ;;

  up)
    # Ensure infra is running
    docker compose up -d postgres redis 2>/dev/null || true

    for svc in "${SERVICES[@]}"; do
      echo "==> Starting $svc"
      docker run -d \
        --name "flash-pump-$svc" \
        --env-file .env \
        -e DATABASE_URL=postgresql://launcher:launcher@postgres:5432/meme_launcher \
        -e REDIS_URL=redis://redis:6379 \
        --network "$NETWORK" \
        --restart unless-stopped \
        "flash-pump/$svc"
    done
    echo "==> All services started. Use 'docker logs -f flash-pump-<service>' to watch."
    ;;

  stop)
    for svc in "${SERVICES[@]}"; do
      docker stop "flash-pump-$svc" 2>/dev/null || true
      docker rm "flash-pump-$svc" 2>/dev/null || true
    done
    echo "==> All services stopped."
    ;;

  *)
    echo "Usage: $0 {build|up|stop}"
    exit 1
    ;;
esac
