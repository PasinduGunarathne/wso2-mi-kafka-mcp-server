# WSO2 MI + Kafka MCP Server

MCP server that provides a complete local Apache Kafka + WSO2 Micro Integrator integration engineering platform — 25 tools for stack management, Kafka administration, message operations, artifact scaffolding, and diagnostics.

Say **"setup kafka and mi"** in Claude Desktop or Claude Code and get a fully working integration stack — no manual steps.

## Architecture

```
HTTP Client ──POST /kafka/publish──> WSO2 MI ──kafkaTransport──> demo.orders.in (Kafka)
                                                                        │
                                     WSO2 MI <──KafkaOrderConsumer──────┘
                                        │
                                   ┌────┴────┐
                                Success    Error
                                   │         │
                          demo.orders.audit  demo.orders.dlq
                          (enriched events)  (dead letter queue)
```

## Prerequisites

- Docker with Compose v2 (Docker Desktop, Rancher Desktop, or Colima)
- Node.js >= 18

## Setup

```bash
npm install
npm run build
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kafka-mi": {
      "command": "node",
      "args": ["/absolute/path/to/wso2-mi-kafka-mcp-server/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add kafka-mi node /absolute/path/to/wso2-mi-kafka-mcp-server/dist/index.js
```

## MI Image Options

The stack can be built from the **official WSO2 Docker Hub image** (default) or a **local MI distribution ZIP**.

**Docker Hub image (default):** No local files needed — pulls `wso2/wso2mi` from Docker Hub.

```bash
docker compose build wso2mi
```

**Local pack:** Place `wso2mi-<version>.zip` in the generated `wso2mi/` directory.

```bash
MI_DOCKERFILE=Dockerfile docker compose build wso2mi
```

**Version selection:** Set `MI_VERSION` (available: 4.3.0, 4.4.0, 4.5.0, with `-alpine` / `-rocky` variants for Docker Hub).

```bash
MI_DOCKERFILE=Dockerfile.dockerhub MI_VERSION=4.5.0 docker compose build wso2mi
```

## MCP Tools (25)

### Stack Management

| Tool | Description |
|------|-------------|
| `setup_kafka_and_mi` | Full automated setup — prerequisites, build, start, topics, smoke test |
| `start_stack` | Start all containers |
| `stop_stack` | Stop all containers (preserves data) |
| `stack_status` | Show container health, topics, API availability |
| `show_logs` | View recent logs (all or per service) |
| `reset_environment` | Stop + remove all containers and volumes |

### Demo & Testing

| Tool | Description |
|------|-------------|
| `run_demo` | Publish a sample event and verify the full flow end-to-end |
| `run_health_checks` | Verify all services are healthy |
| `trigger_error` | Test error handling — routes to Dead Letter Queue |
| `check_dlq` | View failed messages in the DLQ |

### Kafka Administration

| Tool | Description |
|------|-------------|
| `list_kafka_topics` | List all topics (excluding internal topics) |
| `describe_kafka_topic` | Show partitions, replication, configs, ISR for a topic |
| `create_kafka_topic` | Create a new topic with custom partitions and replication |
| `delete_kafka_topic` | Delete a topic (requires confirmation) |

### Message Operations

| Tool | Description |
|------|-------------|
| `publish_message` | Publish a message directly to any Kafka topic |
| `consume_messages` | Consume messages with partition, offset, and timestamp details |
| `search_messages` | Search messages in a topic by substring (case-insensitive) |
| `replay_dlq_to_input` | Replay DLQ messages back to input topic for reprocessing |

### MI Artifact Scaffolding

| Tool | Description |
|------|-------------|
| `generate_mi_api` | Generate a WSO2 MI API artifact from template |
| `generate_mi_sequence` | Generate a mediation sequence with logging and error handling |
| `generate_mi_inbound_endpoint` | Generate a Kafka inbound endpoint consumer |
| `validate_mi_artifacts` | Validate Synapse XML artifacts for common issues |

### Diagnostics & Traceability

| Tool | Description |
|------|-------------|
| `trace_order_flow` | Trace an order through the full flow (input → consumer → audit/DLQ) |
| `collect_stack_diagnostics` | Comprehensive diagnostics — containers, topics, APIs, errors, disk |
| `smoke_test_custom_flow` | Test a custom HTTP API with optional Kafka topic verification |

## Tool Examples

**Kafka admin:**
```
"list kafka topics"
"describe topic demo.orders.in"
"create a topic called payments.events with 5 partitions"
```

**Message operations:**
```
"publish a test message to demo.orders.in"
"consume 5 messages from demo.orders.audit"
"search demo.orders.in for customer Alice"
"replay DLQ messages back to input"
```

**MI artifact scaffolding:**
```
"generate an API called PaymentAPI with context /payments"
"generate a Kafka inbound endpoint for topic payments.events"
"validate my MI artifacts"
```

**Diagnostics:**
```
"trace order demo-1234 through the flow"
"collect stack diagnostics"
"smoke test POST http://localhost:8290/kafka/publish with a test payload"
```

## Services

| Service | Port | URL |
|---------|------|-----|
| Kafka Broker | 9092 | `localhost:9092` |
| Kafka UI | 8090 | http://localhost:8090 |
| WSO2 MI HTTP | 8290 | http://localhost:8290 |
| WSO2 MI HTTPS | 8253 | https://localhost:8253 |
| WSO2 MI Management | 9164 | http://localhost:9164 |

## Kafka Topics

| Topic | Purpose |
|-------|---------|
| `demo.orders.in` | Incoming order events (published by HTTP API) |
| `demo.orders.audit` | Enriched events (consumed, processed, forwarded) |
| `demo.orders.dlq` | Dead Letter Queue (failed/invalid messages) |

## Manual Test

```bash
curl -X POST http://localhost:8290/kafka/publish \
  -H "Content-Type: application/json" \
  -d '{"id":"1001","customer":"Alice","event":"order-created","amount":125.50}'
```

## Project Structure

```
wso2-mi-kafka-mcp-server/
├── src/
│   ├── index.ts                    # MCP server entry point (25 tools)
│   ├── types.ts                    # Domain models
│   ├── tools/
│   │   ├── setup.ts                # setup_kafka_and_mi
│   │   ├── demo.ts                 # run_demo, trigger_error, check_dlq, health checks
│   │   ├── stack.ts                # start/stop/status/logs/reset
│   │   ├── kafka-admin.ts          # list/describe/create/delete topics
│   │   ├── kafka-messages.ts       # publish/consume/search/replay messages
│   │   ├── mi-artifacts.ts         # generate API/sequence/endpoint, validate
│   │   └── diagnostics.ts          # trace flow, diagnostics, smoke test
│   ├── services/
│   │   ├── kafka-service.ts        # Kafka CLI wrappers (docker exec)
│   │   └── mi-service.ts           # MI management API + artifact generation
│   └── utils/
│       ├── docker.ts               # Docker/Compose command wrappers
│       ├── files.ts                # Project file generator (reads from resources/)
│       ├── logger.ts               # Output formatting helpers
│       └── validation.ts           # Input validation
├── resources/
│   ├── artifacts/
│   │   ├── apis/KafkaPublisherAPI.xml
│   │   ├── sequences/
│   │   │   ├── kafkaOrderProcessingSequence.xml
│   │   │   └── kafkaFaultSequence.xml
│   │   ├── inbound-endpoints/KafkaOrderConsumer.xml
│   │   ├── local-entries/KafkaProducerConn.xml
│   │   └── imports/{org.wso2.carbon.connector}kafkaTransport_3.2.0.xml
│   ├── templates/
│   │   ├── api.xml.mustache        # API scaffold template
│   │   ├── sequence.xml.mustache   # Sequence scaffold template
│   │   └── inbound-endpoint.xml.mustache  # Kafka consumer template
│   ├── conf/deployment.toml
│   ├── docker/
│   │   ├── Dockerfile              # Local MI pack
│   │   ├── Dockerfile.dockerhub    # Docker Hub image
│   │   └── docker-compose.yml
│   └── scripts/
│       ├── bootstrap.sh
│       ├── create-topics.sh
│       ├── test-publish.sh
│       ├── test-consume.sh
│       └── verify-stack.sh
├── claude-desktop-config.json      # Example MCP config
├── package.json
└── tsconfig.json
```

## Dependencies Installed in MI Docker Image

**dropins/ (OSGi bundles):** mi-inbound-kafka-2.0.6, kafka-avro-serializer-7.6.0.wso2v1, kafka-schema-serializer-7.6.0.wso2v1, kafka-schema-registry-client-7.6.0.wso2v1, org.apache.avro-1.11.3 (custom OSGi bundle)

**lib/ (classpath JARs):** kafka-clients-3.6.1, common-config-7.6.0, common-utils-7.6.0, metrics-core-2.2.0

**synapse-libs/ (connector):** kafkaTransport-connector-3.2.0.zip

Reference: https://mi.docs.wso2.com/en/latest/reference/connectors/kafka-connector/setting-up-kafka/
