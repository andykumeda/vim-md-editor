#!/usr/bin/env bash
# deploy.sh — build and push web assets to the remote server
#
# Usage:
#   ./deploy.sh              # build + deploy
#   ./deploy.sh --build-only # build without deploying
#   ./deploy.sh --deploy-only # skip build, deploy existing dist/public
#
# Requirements:
#   - SSH host alias "web" configured in ~/.ssh/config
#   - Remote user must own (or have write access to) /var/www/vd

set -euo pipefail

REMOTE_HOST="web"
REMOTE_DIR="/var/www/vd"
LOCAL_BUILD="dist/public"

BUILD=true
DEPLOY=true

for arg in "$@"; do
  case "$arg" in
    --build-only)  DEPLOY=false ;;
    --deploy-only) BUILD=false ;;
  esac
done

# ── Build ─────────────────────────────────────────────────────────────────────
if $BUILD; then
  echo "▶ Building..."
  npm run build:web
  echo "✓ Build complete → ${LOCAL_BUILD}/"
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
if $DEPLOY; then
  if [ ! -d "$LOCAL_BUILD" ]; then
    echo "✗ ${LOCAL_BUILD}/ not found. Run without --deploy-only first." >&2
    exit 1
  fi

  echo "▶ Syncing to ${REMOTE_HOST}:${REMOTE_DIR}..."

  # Ensure the remote directory exists
  ssh "$REMOTE_HOST" "mkdir -p ${REMOTE_DIR}"

  # rsync: delete stale files, compress in transit, preserve timestamps
  rsync -avz --delete \
    --exclude '.DS_Store' \
    "${LOCAL_BUILD}/" \
    "${REMOTE_HOST}:${REMOTE_DIR}/"

  echo "✓ Deploy complete → ${REMOTE_HOST}:${REMOTE_DIR}"
fi
