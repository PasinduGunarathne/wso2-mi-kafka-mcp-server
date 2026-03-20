#!/usr/bin/env bash
# verify-stack.sh — Full end-to-end smoke test
set -euo pipefail

MI_URL="${MI_URL:-http://localhost:8290}"
KAFKA_CONTAINER="${KAFKA_CONTAINER:-demo-kafka}"
PASS=0
FAIL=0

check() {
  local name="$1"; shift
  if "$@" &>/dev/null; then
    echo "  ✅  $name"
    ((PASS++)) || true
  else
    echo "  ❌  $name"
    ((FAIL++)) || true
  fi
}

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Stack Verification                  ║"
echo "╚══════════════════════════════════════╝"

echo ""
echo "── Containers ─────────────────────────"
check "ZooKeeper running"  docker exec demo-zookeeper bash -c "echo ruok | nc localhost 2181"
check "Kafka running"      docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --list
check "WSO2 MI running"    curl -sf http://localhost:9164/management/health

echo ""
echo "── Kafka Topics ───────────────────────"
check "demo.orders.in exists"    docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --describe --topic demo.orders.in
check "demo.orders.audit exists" docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --describe --topic demo.orders.audit

echo ""
echo "── WSO2 MI APIs ───────────────────────"
check "KafkaPublisherAPI health" curl -sf "$MI_URL/kafka/health"

echo ""
echo "── End-to-End Publish Flow ────────────"
RESPONSE=$(curl -sf -X POST "$MI_URL/kafka/publish" \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-001","customer":"TestUser","event":"order-created","amount":1.0}' 2>/dev/null || echo "FAILED")

if echo "$RESPONSE" | grep -q '"status":"published"'; then
  echo "  ✅  Publish API returned success"
  ((PASS++)) || true
else
  echo "  ❌  Publish API failed: $RESPONSE"
  ((FAIL++)) || true
fi

echo ""
echo "── Results ────────────────────────────"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [[ $FAIL -eq 0 ]]; then
  echo ""
  echo "🎉  All checks passed!"
  exit 0
else
  echo ""
  echo "⚠️   Some checks failed. Run: docker compose logs wso2mi"
  exit 1
fi
