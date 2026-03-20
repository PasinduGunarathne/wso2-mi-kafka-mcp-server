# WSO2 MI + Kafka MCP Server

MCP server that fully automates a local Apache Kafka + WSO2 Micro Integrator development stack.

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `setup_kafka_and_mi` | Full automated setup — prerequisites, build, start, topics, smoke test |
| `run_demo` | Publish a sample event and verify the full flow |
| `trigger_error` | Test error handling — routes to Dead Letter Queue |
| `check_dlq` | View failed messages in the DLQ |
| `run_health_checks` | Verify all services are healthy |
| `stack_status` | Show container health, topics, API availability |
| `start_stack` | Start all containers |
| `stop_stack` | Stop all containers (preserves data) |
| `show_logs` | View recent logs (all or per service) |
| `reset_environment` | Stop + remove all containers and volumes |

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
│   ├── index.ts                    # MCP server entry point
│   ├── tools/
│   │   ├── setup.ts                # setup_kafka_and_mi
│   │   ├── demo.ts                 # run_demo, trigger_error, check_dlq, health checks
│   │   └── stack.ts                # start/stop/status/logs/reset
│   └── utils/
│       ├── files.ts                # Project file generator (reads from resources/)
│       ├── docker.ts               # Docker/Compose command wrappers
│       └── logger.ts               # Output formatting helpers
├── resources/
│   ├── artifacts/
│   │   ├── apis/KafkaPublisherAPI.xml
│   │   ├── sequences/
│   │   │   ├── kafkaOrderProcessingSequence.xml
│   │   │   └── kafkaFaultSequence.xml
│   │   ├── inbound-endpoints/KafkaOrderConsumer.xml
│   │   ├── local-entries/KafkaProducerConn.xml
│   │   └── imports/{org.wso2.carbon.connector}kafkaTransport_3.2.0.xml
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
