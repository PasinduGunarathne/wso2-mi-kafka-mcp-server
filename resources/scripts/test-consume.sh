#!/usr/bin/env bash
# test-consume.sh — Tail Kafka topics to see consumed and audit messages
set -euo pipefail

CONTAINER="${KAFKA_CONTAINER:-demo-kafka}"
BOOTSTRAP="localhost:9092"
TIMEOUT="${TIMEOUT:-10}"

echo "=== Tailing demo.orders.in (last 10 messages) ==="
timeout "$TIMEOUT" docker exec "$CONTAINER" \
  kafka-console-consumer \
  --bootstrap-server "$BOOTSTRAP" \
  --topic demo.orders.in \
  --from-beginning \
  --max-messages 10 2>/dev/null || true

echo ""
echo "=== Tailing demo.orders.audit (last 10 messages) ==="
timeout "$TIMEOUT" docker exec "$CONTAINER" \
  kafka-console-consumer \
  --bootstrap-server "$BOOTSTRAP" \
  --topic demo.orders.audit \
  --from-beginning \
  --max-messages 10 2>/dev/null || true
