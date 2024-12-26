#!/usr/bin/env bash

set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

cleanup() {
    log "Stopping application..."
    if [ -f "/app/tmp/app.pid" ]; then
        kill -TERM "$(cat /app/tmp/app.pid)" 2>/dev/null || true
    fi
    sleep 2
    log "Cleanup complete"
    exit 0
}

error_handler() {
    log "Error occurred on line $1"
    cleanup
}

trap cleanup SIGTERM SIGINT SIGQUIT
trap 'error_handler ${LINENO}' ERR

mkdir -p /app/tmp

required_vars=("NODE_ENV")
for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
        log "Error: Required environment variable $var not set"
        exit 1
    fi
done

if [ ! -f "/app/src/cli.ts" ]; then
    log "Error: cli.ts file not found"
    exit 1
fi

pre_start_check() {
    if ! command -v bun &>/dev/null; then
        log "Error: bun is not installed"
        exit 1
    fi

    if [ ! -d "/app/node_modules" ]; then
        log "Error: node_modules directory not found"
        exit 1
    fi
}

main() {
    log "Running pre-start checks..."
    pre_start_check

    log "Starting application..."

    export BUN_MAX_HEAP=2048

    exec bun run src/cli.ts "$@" &

    echo $! >/app/tmp/app.pid

    wait $!
}

main "$@"
