#!/usr/bin/env bash
# test-publish.sh — Publish a sample order event via WSO2 MI HTTP API
set -euo pipefail

MI_URL="${MI_URL:-http://localhost:8290}"

echo "Publishing sample order event to $MI_URL/kafka/publish ..."

curl -sf -X POST "$MI_URL/kafka/publish" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "demo-001",
    "customer": "Alice",
    "event": "order-created",
    "amount": 125.50
  }' | (command -v jq &>/dev/null && jq . || cat)

echo ""
echo "✅  Publish request sent. Check MI logs for confirmation."
