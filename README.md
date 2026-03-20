# WSO2 MI + Kafka MCP Server

A local development platform that lets you control Apache Kafka and WSO2 Micro Integrator directly from Claude. One prompt sets up the entire stack. 25 MCP tools handle everything after that — topic management, message publishing, artifact generation, diagnostics, and more.

**The core outcome:** You clone this repo, register it with Claude, say *"setup kafka and mi"*, and get a fully working Kafka + WSO2 MI integration stack running in Docker — no manual Docker commands, no YAML editing, no configuration steps.

## What You Get

- A running Kafka broker, ZooKeeper, Kafka UI, and WSO2 Micro Integrator — all in Docker
- A working demo flow: HTTP POST → Kafka → WSO2 MI consumer → enriched audit topic
- Error handling with a Dead Letter Queue (DLQ)
- 25 MCP tools to manage topics, publish/consume messages, generate MI artifacts, trace message flows, and troubleshoot
- Everything controlled through natural language in Claude

## Who This Is For

- **Integration engineers** building Kafka + WSO2 MI flows locally
- **Developers** who want a one-command local Kafka/MI stack for testing
- **Claude Desktop or Claude Code users** who want to manage infrastructure through conversation

## Quick Start

This gets you from a fresh clone to a running stack. Follow every step in order.

### Step 1: Check prerequisites

You need Docker and Node.js. Run these commands to verify:

```bash
docker --version        # Need Docker with Compose v2
docker compose version  # Should print "Docker Compose version v2.x.x"
node --version          # Need v18 or higher
```

If `docker compose version` fails, install or update Docker Desktop, Rancher Desktop, or Colima.

### Step 2: Clone and build

```bash
git clone https://github.com/PasinduGunarathne/wso2-mi-kafka-mcp-server.git
cd wso2-mi-kafka-mcp-server
npm install
npm run build
```

The `npm run build` step creates a `dist/` directory. The MCP server won't work without it.

### Step 3: Get the absolute path

You'll need this in the next step. Copy the output of:

```bash
echo "$(pwd)/dist/index.js"
```

Example output: `/Users/you/wso2-mi-kafka-mcp-server/dist/index.js`

### Step 4: Register the MCP server

Choose **one** — Claude Desktop or Claude Code.

#### Option A: Claude Desktop

Open (or create) the config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this block (replace the path with your actual path from Step 3):

```json
{
  "mcpServers": {
    "kafka-mi": {
      "command": "node",
      "args": ["/Users/you/wso2-mi-kafka-mcp-server/dist/index.js"]
    }
  }
}
```

Then **quit and reopen Claude Desktop** (not just close the window — fully quit the app).

**How to verify:** Open a new conversation and look for a hammer/tools icon. Click it — you should see tools starting with `setup_kafka_and_mi`.

#### Option B: Claude Code

Run this command (replace the path with your actual path from Step 3):

```bash
claude mcp add kafka-mi node /Users/you/wso2-mi-kafka-mcp-server/dist/index.js
```

**How to verify:** Run `claude mcp list` and confirm `kafka-mi` appears.

### Step 5: Run your first setup

Make sure Docker is running, then open Claude and type:

```
setup kafka and mi
```

Claude will call the `setup_kafka_and_mi` tool. This takes 3–5 minutes on the first run because it downloads Docker images and builds the WSO2 MI container. You'll see progress output as it:

1. Checks Docker and Node.js are available
2. Generates all project files in `~/kafka-mi-demo`
3. Builds the Docker images (downloads WSO2 MI, Kafka connector JARs)
4. Starts 4 containers (ZooKeeper, Kafka, Kafka UI, WSO2 MI)
5. Creates 3 Kafka topics
6. Runs a smoke test to verify the flow works

### Step 6: Confirm it worked

After setup completes, tell Claude:

```
run health checks
```

All checks should pass. You can also verify manually:

| Check | How |
|-------|-----|
| Containers running | `docker ps` — should show 4 containers with `demo-` prefix |
| Kafka UI accessible | Open http://localhost:8090 in your browser |
| WSO2 MI accessible | Open http://localhost:8290/kafka/health — should return `{"status":"ok"}` |
| Topics created | In Kafka UI, click "Topics" — should see `demo.orders.in`, `demo.orders.audit`, `demo.orders.dlq` |

## Your First 10 Minutes

Once the stack is running, try these prompts in order:

### 1. Run the demo

```
run demo
```

This publishes a sample order event through the full flow: HTTP → Kafka → WSO2 MI consumer → audit topic. Claude shows you evidence at each step.

### 2. Test error handling

```
trigger error
```

This sends a message that intentionally fails processing and gets routed to the Dead Letter Queue.

### 3. Check the DLQ

```
check dlq
```

Shows the failed messages with error details and original payloads.

### 4. Explore Kafka

```
list kafka topics
```

```
consume 5 messages from demo.orders.audit
```

### What success looks like

After these steps, you should have:

- 4 Docker containers running and healthy (`docker ps`)
- 3 Kafka topics visible in the Kafka UI at http://localhost:8090
- Messages visible in `demo.orders.in` (raw), `demo.orders.audit` (enriched), and `demo.orders.dlq` (failed)
- WSO2 MI responding at http://localhost:8290/kafka/health

## Architecture

Here's what happens when a message flows through the system:

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

**In plain English:**

1. You (or Claude) sends a JSON order event via HTTP POST to WSO2 MI
2. WSO2 MI validates it and publishes it to the `demo.orders.in` Kafka topic
3. A Kafka inbound endpoint in WSO2 MI polls that topic and consumes the message
4. The processing sequence validates, enriches, and branches on the event type
5. On success: the enriched message goes to `demo.orders.audit`
6. On error: the message goes to `demo.orders.dlq` with error details attached

## Services and Ports

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Kafka Broker | 9092 | `localhost:9092` | Message broker |
| Kafka UI | 8090 | http://localhost:8090 | Web UI to browse topics and messages |
| WSO2 MI HTTP | 8290 | http://localhost:8290 | Integration API endpoint |
| WSO2 MI HTTPS | 8253 | https://localhost:8253 | Secure API endpoint |
| WSO2 MI Management | 9164 | http://localhost:9164 | MI management/admin API |

## Kafka Topics

| Topic | Purpose |
|-------|---------|
| `demo.orders.in` | Incoming order events (published by HTTP API) |
| `demo.orders.audit` | Enriched events (consumed, processed, forwarded) |
| `demo.orders.dlq` | Dead Letter Queue (failed/invalid messages) |

## Common Prompts by Purpose

Copy-paste these into Claude to use the MCP tools.

**Stack management:**
```
setup kafka and mi
stack status
show logs for wso2mi
start stack
stop stack
```

**Demo and testing:**
```
run demo
run health checks
trigger error with type missing-id
check dlq
```

**Kafka topic management:**
```
list kafka topics
describe topic demo.orders.in
create a topic called payments.events with 5 partitions
delete topic payments.events
```

**Publishing and consuming messages:**
```
publish {"id":"2001","customer":"Bob","event":"order-created","amount":50} to demo.orders.in
consume 10 messages from demo.orders.audit
search demo.orders.in for customer Alice
replay DLQ messages back to input
```

**MI artifact scaffolding:**
```
generate an API called PaymentAPI with context /payments
generate a sequence called paymentProcessingSequence
generate a Kafka inbound endpoint for topic payments.events
validate my MI artifacts
```

**Diagnostics:**
```
trace order demo-1234 through the flow
collect stack diagnostics
smoke test POST http://localhost:8290/kafka/publish with body {"id":"test","event":"order-created","customer":"Test","amount":1}
```

## Manual Test (Without Claude)

If you want to test the running stack directly from your terminal, use curl:

```bash
curl -X POST http://localhost:8290/kafka/publish \
  -H "Content-Type: application/json" \
  -d '{"id":"1001","customer":"Alice","event":"order-created","amount":125.50}'
```

Expected response:
```json
{"status":"published","topic":"demo.orders.in","orderId":"1001","event":"order-created","timestamp":"...","message":"Event successfully published to Kafka"}
```

This is useful for verifying the stack works independently of Claude, or for scripted testing.

## Full MCP Tools Reference (25)

### Stack Management

| Tool | Description |
|------|-------------|
| `setup_kafka_and_mi` | Full automated setup — prerequisites, build, start, topics, smoke test |
| `start_stack` | Start all containers |
| `stop_stack` | Stop all containers (preserves data) |
| `stack_status` | Show container health, topics, API availability |
| `show_logs` | View recent logs (all or per service: wso2mi, kafka, zookeeper, kafka-ui) |
| `reset_environment` | Stop + remove all containers and volumes (requires confirm=true) |

### Demo & Testing

| Tool | Description |
|------|-------------|
| `run_demo` | Publish a sample event and verify the full flow end-to-end |
| `run_health_checks` | Verify all services are healthy |
| `trigger_error` | Test error handling — routes to Dead Letter Queue (types: processing, missing-id, missing-event) |
| `check_dlq` | View failed messages in the DLQ with error details |

### Kafka Administration

| Tool | Description |
|------|-------------|
| `list_kafka_topics` | List all topics (excluding internal topics) |
| `describe_kafka_topic` | Show partitions, replication, configs, ISR for a topic |
| `create_kafka_topic` | Create a new topic with custom partitions and replication factor |
| `delete_kafka_topic` | Delete a topic (requires confirm=true) |

### Message Operations

| Tool | Description |
|------|-------------|
| `publish_message` | Publish a message directly to any Kafka topic (supports optional key) |
| `consume_messages` | Consume messages with partition, offset, and timestamp details |
| `search_messages` | Search messages in a topic by substring (case-insensitive) |
| `replay_dlq_to_input` | Replay DLQ messages back to input topic for reprocessing (requires confirm=true) |

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
| `collect_stack_diagnostics` | Comprehensive diagnostics — containers, topics, APIs, errors, disk usage |
| `smoke_test_custom_flow` | Test a custom HTTP endpoint with optional Kafka topic verification |

## Troubleshooting

### Docker not running

```
Error: Cannot connect to the Docker daemon
```

Start Docker Desktop, Rancher Desktop, or Colima before running setup.

### Port already in use

```
Error: port is already allocated
```

Another service is using one of the required ports (8090, 8290, 8253, 9092, 9164). Stop the conflicting service or change the port in `docker-compose.yml`.

### Claude doesn't see the MCP server

- **Did you build?** Run `npm run build` — the `dist/index.js` file must exist.
- **Is the path correct?** The path in your config must be absolute (starts with `/` on macOS/Linux or `C:\` on Windows), not relative.
- **Did you restart?** Claude Desktop needs a full quit and reopen after config changes.
- **Check Claude Code:** Run `claude mcp list` to verify registration.

### Containers started but not healthy yet

WSO2 MI takes 60–90 seconds to fully start. If health checks fail immediately after setup, wait a minute and try again:

```
run health checks
```

### Topic not found

If a topic command fails, the Kafka container might not be ready. Check with:

```
stack status
```

If Kafka shows as unhealthy, wait for it to finish starting or check logs:

```
show logs for kafka
```

### Something is broken and you want to start over

```
reset environment
```

This stops all containers and deletes all data volumes. Then run `setup kafka and mi` again.

## Daily Workflow

### Starting a new day (stack was stopped)

```
start stack
```

Then wait ~60 seconds for WSO2 MI to be healthy. Verify with `run health checks`.

### Stopping when done

```
stop stack
```

This preserves all data. Your topics and messages will still be there when you start again.

### Checking what's running

```
stack status
```

### Viewing logs

```
show logs                     # all services
show logs for wso2mi          # just WSO2 MI
show logs for kafka           # just Kafka
```

### Full reset (delete everything)

```
reset environment
```

Then `setup kafka and mi` to start fresh.

## Advanced: MI Image Options

> Most users can skip this section. The default Docker Hub image works out of the box.

The WSO2 MI container can be built from two sources:

**Docker Hub image (default):** Pulls `wso2/wso2mi` automatically. No local files needed.

```bash
docker compose build wso2mi
```

**Local distribution ZIP:** Place `wso2mi-<version>.zip` in the generated `wso2mi/` directory, then:

```bash
MI_DOCKERFILE=Dockerfile docker compose build wso2mi
```

**Selecting a specific MI version:** Available versions: 4.3.0, 4.4.0 (default), 4.5.0. Docker Hub also has `-alpine` and `-rocky` variants.

```bash
MI_DOCKERFILE=Dockerfile.dockerhub MI_VERSION=4.5.0 docker compose build wso2mi
```

## Advanced: Extensibility

For power users who want to build custom integration flows:

- **Artifact scaffolding:** Use `generate_mi_api`, `generate_mi_sequence`, and `generate_mi_inbound_endpoint` to create new Synapse XML artifacts from templates. These generate production-ready boilerplate with proper namespaces, logging, and error handling.
- **Validation:** Use `validate_mi_artifacts` to check your XML files for common mistakes before deploying (missing attributes, wrong namespaces, Kafka config issues).
- **Custom smoke tests:** Use `smoke_test_custom_flow` to test any HTTP endpoint and optionally verify that a message appeared in a Kafka topic.
- **Order tracing:** Use `trace_order_flow` to follow a specific order ID through every stage of the pipeline — input topic, MI consumer logs, audit topic, and DLQ.

## Project Structure

```
wso2-mi-kafka-mcp-server/
├── src/
│   ├── index.ts                    # Server entry point — registers all 25 MCP tools
│   ├── types.ts                    # TypeScript interfaces for topics, messages, traces
│   ├── tools/
│   │   ├── setup.ts                # One-command stack setup (setup_kafka_and_mi)
│   │   ├── demo.ts                 # Demo flow, error triggers, DLQ checks, health checks
│   │   ├── stack.ts                # Start, stop, status, logs, reset
│   │   ├── kafka-admin.ts          # Topic CRUD operations
│   │   ├── kafka-messages.ts       # Publish, consume, search, replay messages
│   │   ├── mi-artifacts.ts         # Generate and validate WSO2 MI XML artifacts
│   │   └── diagnostics.ts          # Order tracing, diagnostics, custom smoke tests
│   ├── services/
│   │   ├── kafka-service.ts        # Runs kafka-* CLI commands inside the Kafka container
│   │   └── mi-service.ts           # Calls WSO2 MI management API, renders XML templates
│   └── utils/
│       ├── docker.ts               # Docker and Compose command wrappers with timeouts
│       ├── files.ts                # Copies resource files into the project directory
│       ├── logger.ts               # Colored output formatting for tool results
│       └── validation.ts           # Input validation (topic names, required fields)
├── resources/
│   ├── artifacts/                  # Pre-built WSO2 MI Synapse XML artifacts
│   │   ├── apis/                   #   HTTP API that publishes to Kafka
│   │   ├── sequences/              #   Processing sequence + fault/DLQ sequence
│   │   ├── inbound-endpoints/      #   Kafka consumer endpoint
│   │   ├── local-entries/          #   Kafka producer connection config
│   │   └── imports/                #   Kafka connector import declaration
│   ├── templates/                  # Mustache templates for artifact generation
│   ├── conf/deployment.toml        # WSO2 MI server configuration
│   ├── docker/                     # Dockerfiles and docker-compose.yml
│   └── scripts/                    # Shell scripts for topic creation and testing
├── claude-desktop-config.json      # Example MCP config (copy into your Claude config)
├── package.json
└── tsconfig.json
```

## MI Docker Image Dependencies

**dropins/ (OSGi bundles):** mi-inbound-kafka-2.0.6, kafka-avro-serializer-7.6.0.wso2v1, kafka-schema-serializer-7.6.0.wso2v1, kafka-schema-registry-client-7.6.0.wso2v1, org.apache.avro-1.11.3 (custom OSGi bundle)

**lib/ (classpath JARs):** kafka-clients-3.6.1, common-config-7.6.0, common-utils-7.6.0, metrics-core-2.2.0

**synapse-libs/ (connector):** kafkaTransport-connector-3.2.0.zip

Reference: https://mi.docs.wso2.com/en/latest/reference/connectors/kafka-connector/setting-up-kafka/
