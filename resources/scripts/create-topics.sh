#!/usr/bin/env bash
# create-topics.sh — Create required Kafka topics inside the demo-kafka container
set -euo pipefail

CONTAINER="${KAFKA_CONTAINER:-demo-kafka}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"

echo "Creating Kafka topics..."

for TOPIC in demo.orders.in demo.orders.audit; do
  docker exec "$CONTAINER" kafka-topics \
    --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$TOPIC" \
    --partitions 3 \
    --replication-factor 1
  echo "  ✅  Topic '$TOPIC' ready"
done

echo "All topics created."
docker exec "$CONTAINER" kafka-topics --bootstrap-server "$BOOTSTRAP" --list
