#!/usr/bin/env bash
# bootstrap.sh — One-command setup: starts stack, waits for health, creates topics
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Kafka + WSO2 MI — Bootstrap Script              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Prerequisites check ────────────────────────────────────────────────
echo "[1/6] Checking prerequisites..."
for bin in docker curl; do
  if ! command -v "$bin" &>/dev/null; then
    echo "❌  '$bin' not found. Please install it first."
    exit 1
  fi
done
if ! docker compose version &>/dev/null; then
  echo "❌  'docker compose' (v2 plugin) not found. Please install Docker Desktop or the compose plugin."
  exit 1
fi
echo "  ✅  docker + docker compose found"

# ── Step 2: Build and start containers ─────────────────────────────────────────
echo ""
echo "[2/6] Starting containers (this builds the WSO2 MI image on first run)..."
cd "$PROJECT_DIR"
docker compose up -d --build --remove-orphans

# ── Step 3: Wait for Kafka ──────────────────────────────────────────────────────
echo ""
echo "[3/6] Waiting for Kafka to be ready (up to 120s)..."
DEADLINE=$((SECONDS + 120))
until docker exec demo-kafka kafka-topics --bootstrap-server localhost:9092 --list &>/dev/null; do
  if [[ $SECONDS -ge $DEADLINE ]]; then
    echo "❌  Kafka did not start in time. Check: docker compose logs kafka"
    exit 1
  fi
  echo "  ⏳  Waiting..."
  sleep 5
done
echo "  ✅  Kafka is ready"

# ── Step 4: Create Kafka topics ─────────────────────────────────────────────────
echo ""
echo "[4/6] Creating Kafka topics..."
bash "$SCRIPT_DIR/create-topics.sh"

# ── Step 5: Wait for WSO2 MI ───────────────────────────────────────────────────
echo ""
echo "[5/6] Waiting for WSO2 MI to be ready (up to 180s)..."
DEADLINE=$((SECONDS + 180))
until curl -sf http://localhost:9164/management/health &>/dev/null; do
  if [[ $SECONDS -ge $DEADLINE ]]; then
    echo "❌  WSO2 MI did not start in time. Check: docker compose logs wso2mi"
    exit 1
  fi
  echo "  ⏳  Waiting..."
  sleep 10
done
echo "  ✅  WSO2 MI is ready"

# ── Step 6: Run smoke test ──────────────────────────────────────────────────────
echo ""
echo "[6/6] Running smoke test..."
bash "$SCRIPT_DIR/test-publish.sh"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  🎉  Stack is READY!                              ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Services:                                       ║"
echo "║    Kafka broker:     localhost:9092               ║"
echo "║    Kafka UI:         http://localhost:8090        ║"
echo "║    WSO2 MI API:      http://localhost:8290        ║"
echo "║    WSO2 Mgmt API:    http://localhost:9164        ║"
echo "║                                                  ║"
echo "║  Publish an order:                               ║"
echo "║    scripts/test-publish.sh                       ║"
echo "║                                                  ║"
echo "║  View consumed messages:                         ║"
echo "║    scripts/test-consume.sh                       ║"
echo "║                                                  ║"
echo "║  Full verification:                              ║"
echo "║    scripts/verify-stack.sh                       ║"
echo "╚══════════════════════════════════════════════════╝"
