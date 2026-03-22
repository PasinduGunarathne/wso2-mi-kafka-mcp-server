#!/usr/bin/env node
/**
 * kafka-mi-mcp-server
 * ───────────────────
 * MCP Server for a local Kafka + WSO2 Micro Integrator integration platform.
 *
 * Stack Management:  setup_kafka_and_mi, start_stack, stop_stack, stack_status,
 *                    reset_environment, show_logs, get_mi_config
 * Demo & Testing:    run_demo, trigger_error, check_dlq, run_health_checks
 * Kafka Admin:       list_kafka_topics, describe_kafka_topic, create_kafka_topic,
 *                    delete_kafka_topic
 * Message Ops:       publish_message, consume_messages, replay_dlq_to_input,
 *                    search_messages
 * MI Artifacts:      generate_mi_api, generate_mi_sequence,
 *                    generate_mi_inbound_endpoint, validate_mi_artifacts
 * Diagnostics:       trace_order_flow, collect_stack_diagnostics,
 *                    smoke_test_custom_flow
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Tool handlers ────────────────────────────────────────────────────────────
import { setupKafkaAndMI }  from "./tools/setup.js";
import { runDemo, runHealthChecks, triggerError, checkDLQ } from "./tools/demo.js";
import {
  startStack, stopStack, stackStatus, showLogs, resetEnvironment, getMiConfig,
} from "./tools/stack.js";
import {
  listKafkaTopics, describeKafkaTopic, createKafkaTopic, deleteKafkaTopic,
} from "./tools/kafka-admin.js";
import {
  publishMessage, consumeMessages, replayDLQToInput, searchMessages,
} from "./tools/kafka-messages.js";
import {
  generateMiApi, generateMiSequence, generateMiInboundEndpoint, validateMiArtifacts,
} from "./tools/mi-artifacts.js";
import {
  traceOrderFlow, collectStackDiagnostics, smokeTestCustomFlow,
} from "./tools/diagnostics.js";

// ── Handler registry (name → function) ──────────────────────────────────────
const HANDLERS: Record<string, (args: any) => Promise<string>> = {
  // Stack management
  setup_kafka_and_mi:   setupKafkaAndMI,
  start_stack:          startStack,
  stop_stack:           stopStack,
  stack_status:         stackStatus,
  show_logs:            showLogs,
  reset_environment:    resetEnvironment,
  get_mi_config:        getMiConfig,
  // Demo & testing
  run_demo:             runDemo,
  run_health_checks:    runHealthChecks,
  trigger_error:        triggerError,
  check_dlq:            checkDLQ,
  // Kafka administration
  list_kafka_topics:    listKafkaTopics,
  describe_kafka_topic: describeKafkaTopic,
  create_kafka_topic:   createKafkaTopic,
  delete_kafka_topic:   deleteKafkaTopic,
  // Message operations
  publish_message:      publishMessage,
  consume_messages:     consumeMessages,
  replay_dlq_to_input:  replayDLQToInput,
  search_messages:      searchMessages,
  // MI artifact scaffolding
  generate_mi_api:              generateMiApi,
  generate_mi_sequence:         generateMiSequence,
  generate_mi_inbound_endpoint: generateMiInboundEndpoint,
  validate_mi_artifacts:        validateMiArtifacts,
  // Diagnostics & traceability
  trace_order_flow:             traceOrderFlow,
  collect_stack_diagnostics:    collectStackDiagnostics,
  smoke_test_custom_flow:       smokeTestCustomFlow,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (MCP schema)
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  // ── Stack Management ────────────────────────────────────────────────────────
  {
    name: "setup_kafka_and_mi",
    description:
      "Setup Apache Kafka + WSO2 Micro Integrator integration stack. " +
      "When called WITHOUT miSource, shows an interactive menu to choose between Docker Hub image or local MI pack. " +
      "When called WITH miSource, runs the full automated setup: prerequisites, build, start, topics, smoke test. " +
      "IMPORTANT: Always call this tool first without miSource to show the user the options. " +
      "Then call again with the user's choice. " +
      "Trigger phrases: 'setup kafka and mi', 'start kafka', 'setup integration stack'.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string",  description: "Directory where the project will be created (default: <home>/kafka-mi-demo)." },
        skipBuild:   { type: "boolean", description: "Skip Docker image build (use cached images). Default: false." },
        miSource:    { type: "string",  enum: ["dockerhub", "local"], description: "MI image source. 'dockerhub' pulls the official WSO2 image. 'local' uses a wso2mi-<version>.zip. OMIT this to show the option menu first." },
        miVersion:   { type: "string",  description: "WSO2 MI version. Docker Hub: 4.3.0, 4.4.0, 4.5.0 (append -alpine or -rocky for variants). Local: must match the ZIP filename. Default: 4.5.0." },
      },
    },
  },
  {
    name: "start_stack",
    description: "Start all Docker containers for the Kafka + WSO2 MI stack.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Project directory (default: <home>/kafka-mi-demo)" },
      },
    },
  },
  {
    name: "stop_stack",
    description: "Stop all running containers. Preserves data volumes.",
    inputSchema: { type: "object", properties: { projectPath: { type: "string" } } },
  },
  {
    name: "stack_status",
    description: "Show current status of all services — container health, Kafka topics, WSO2 MI APIs.",
    inputSchema: { type: "object", properties: { projectPath: { type: "string" } } },
  },
  {
    name: "show_logs",
    description: "Show recent logs. Optionally filter by service: wso2mi, kafka, zookeeper, kafka-ui.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["wso2mi", "kafka", "zookeeper", "kafka-ui"], description: "Service to show logs for. Omit for all." },
        tail:    { type: "number", description: "Number of log lines (default: 50)." },
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "reset_environment",
    description: "Stop all containers and DELETE all volumes. Requires confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        confirm:     { type: "boolean", description: "Must be true to confirm." },
      },
    },
  },
  {
    name: "get_mi_config",
    description:
      "Show the current WSO2 MI configuration — whether it uses Docker Hub or a local pack, " +
      "the MI version, detected local ZIP files, and available Docker Hub versions. " +
      "Trigger phrases: 'what MI version', 'show mi config', 'which MI image', 'get mi config'.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Project directory (default: <home>/kafka-mi-demo)." },
      },
    },
  },

  // ── Demo & Testing ──────────────────────────────────────────────────────────
  {
    name: "run_demo",
    description:
      "End-to-end demo: publish a sample order → verify Kafka → verify WSO2 MI consumer → check audit topic.",
    inputSchema: {
      type: "object",
      properties: {
        orderId:  { type: "string",  description: "Custom order ID (default: auto)" },
        customer: { type: "string",  description: "Customer name (default: Alice)" },
        event:    { type: "string",  description: "Event type (default: order-created)" },
        amount:   { type: "number",  description: "Order amount (default: 125.50)" },
      },
    },
  },
  {
    name: "run_health_checks",
    description: "Run all health checks — ZooKeeper, Kafka, topics, WSO2 MI APIs, deployed artifacts.",
    inputSchema: { type: "object", properties: { projectPath: { type: "string" } } },
  },
  {
    name: "trigger_error",
    description:
      "Test error handling: send a message that fails processing → routes to DLQ. " +
      "Error types: 'processing', 'missing-id', 'missing-event'.",
    inputSchema: {
      type: "object",
      properties: {
        errorType: { type: "string", enum: ["processing", "missing-id", "missing-event"], description: "Default: 'processing'." },
        orderId:   { type: "string", description: "Custom order ID (default: auto)." },
      },
    },
  },
  {
    name: "check_dlq",
    description: "Read failed messages from the Dead Letter Queue (demo.orders.dlq).",
    inputSchema: {
      type: "object",
      properties: {
        maxMessages: { type: "number", description: "Max messages to read (default: 10)." },
      },
    },
  },

  // ── Kafka Administration ────────────────────────────────────────────────────
  {
    name: "list_kafka_topics",
    description: "List all Kafka topics (excluding internal topics like __consumer_offsets).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "describe_kafka_topic",
    description: "Show detailed info for a Kafka topic — partitions, replication, configs, ISR.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic name to describe." },
      },
      required: ["topic"],
    },
  },
  {
    name: "create_kafka_topic",
    description: "Create a new Kafka topic with specified partitions and replication factor.",
    inputSchema: {
      type: "object",
      properties: {
        name:              { type: "string",  description: "Topic name." },
        partitions:        { type: "number",  description: "Number of partitions (default: 3)." },
        replicationFactor: { type: "number",  description: "Replication factor (default: 1)." },
        configs:           { type: "object",  description: "Optional topic configs (e.g. { \"retention.ms\": \"86400000\" })." },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_kafka_topic",
    description: "Delete a Kafka topic. Requires confirm=true to prevent accidental deletion.",
    inputSchema: {
      type: "object",
      properties: {
        topic:   { type: "string",  description: "Topic to delete." },
        confirm: { type: "boolean", description: "Must be true to confirm deletion." },
      },
      required: ["topic"],
    },
  },

  // ── Message Operations ──────────────────────────────────────────────────────
  {
    name: "publish_message",
    description: "Publish a message directly to any Kafka topic. Supports optional key.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Target topic." },
        value: { type: "string", description: "Message value (JSON string or plain text)." },
        key:   { type: "string", description: "Optional message key for partitioning." },
      },
      required: ["topic", "value"],
    },
  },
  {
    name: "consume_messages",
    description: "Consume messages from a Kafka topic. Shows partition, offset, timestamp, and value.",
    inputSchema: {
      type: "object",
      properties: {
        topic:         { type: "string",  description: "Topic to consume from." },
        maxMessages:   { type: "number",  description: "Max messages to read (default: 10)." },
        timeoutMs:     { type: "number",  description: "Consumer timeout in ms (default: 10000)." },
        fromBeginning: { type: "boolean", description: "Read from beginning (default: true)." },
        groupId:       { type: "string",  description: "Consumer group ID (optional)." },
      },
      required: ["topic"],
    },
  },
  {
    name: "replay_dlq_to_input",
    description:
      "Replay DLQ messages back to an input topic for reprocessing. " +
      "Extracts original payload from DLQ envelope. Requires confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        dlqTopic:    { type: "string",  description: "DLQ topic (default: demo.orders.dlq)." },
        targetTopic: { type: "string",  description: "Target topic (default: demo.orders.in)." },
        maxMessages: { type: "number",  description: "Max messages to replay (default: 10)." },
        confirm:     { type: "boolean", description: "Must be true to proceed." },
      },
    },
  },
  {
    name: "search_messages",
    description: "Search messages in a Kafka topic by substring match. Reads up to 500 messages and filters.",
    inputSchema: {
      type: "object",
      properties: {
        topic:      { type: "string", description: "Topic to search." },
        query:      { type: "string", description: "Search string (case-insensitive)." },
        maxResults: { type: "number", description: "Max results to return (default: 20)." },
      },
      required: ["topic", "query"],
    },
  },

  // ── MI Artifact Scaffolding ─────────────────────────────────────────────────
  {
    name: "generate_mi_api",
    description:
      "Generate a WSO2 MI API artifact from template. " +
      "Creates a Synapse XML file with request handling, logging, and error handling.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "API name (e.g. 'OrderAPI')." },
        context:     { type: "string", description: "URL context path (default: /<name>)." },
        methods:     { type: "array", items: { type: "string" }, description: "HTTP methods (default: ['POST','GET'])." },
        description: { type: "string", description: "API description." },
        outputDir:   { type: "string", description: "Directory to write the XML file (optional)." },
      },
      required: ["name"],
    },
  },
  {
    name: "generate_mi_sequence",
    description:
      "Generate a WSO2 MI mediation sequence artifact. " +
      "Creates a Synapse XML sequence with logging and error handling scaffolding.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Sequence name." },
        onError:     { type: "string", description: "Error sequence name (default: kafkaFaultSequence)." },
        description: { type: "string", description: "Sequence description." },
        outputDir:   { type: "string", description: "Directory to write the XML file (optional)." },
      },
      required: ["name"],
    },
  },
  {
    name: "generate_mi_inbound_endpoint",
    description:
      "Generate a Kafka inbound endpoint artifact for WSO2 MI. " +
      "Creates a consumer that polls a Kafka topic and dispatches to a processing sequence.",
    inputSchema: {
      type: "object",
      properties: {
        name:             { type: "string", description: "Endpoint name." },
        topic:            { type: "string", description: "Kafka topic to consume (default: demo.orders.in)." },
        groupId:          { type: "string", description: "Consumer group ID (default: auto)." },
        bootstrapServers: { type: "string", description: "Bootstrap servers (default: kafka:29092)." },
        pollInterval:     { type: "number", description: "Poll interval in ms (default: 1000)." },
        onError:          { type: "string", description: "Error sequence (default: kafkaFaultSequence)." },
        description:      { type: "string", description: "Endpoint description." },
        outputDir:        { type: "string", description: "Directory to write the XML file (optional)." },
      },
      required: ["name"],
    },
  },
  {
    name: "validate_mi_artifacts",
    description:
      "Validate WSO2 MI Synapse XML artifacts for common issues — missing attributes, " +
      "namespace problems, Kafka config errors. Scans a file or directory.",
    inputSchema: {
      type: "object",
      properties: {
        file:      { type: "string", description: "Path to a single XML file to validate." },
        directory: { type: "string", description: "Directory of XML files to validate." },
      },
    },
  },

  // ── Diagnostics & Traceability ──────────────────────────────────────────────
  {
    name: "trace_order_flow",
    description:
      "Trace an order through the full flow: input topic → MI consumer → audit topic / DLQ. " +
      "Shows exactly where the message is and whether it succeeded or failed.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The order ID to trace." },
      },
      required: ["orderId"],
    },
  },
  {
    name: "collect_stack_diagnostics",
    description:
      "Comprehensive stack diagnostics — container health, topics, deployed MI artifacts, " +
      "recent errors, Docker disk usage. Use when troubleshooting.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "smoke_test_custom_flow",
    description:
      "Run a custom smoke test: send an HTTP request and optionally verify the result " +
      "appears in a Kafka topic. Useful for testing custom APIs and flows.",
    inputSchema: {
      type: "object",
      properties: {
        url:             { type: "string",  description: "URL to send the request to." },
        method:          { type: "string",  description: "HTTP method (default: POST)." },
        body:            { type: "string",  description: "Request body (JSON string)." },
        headers:         { type: "object",  description: "Custom headers." },
        expectStatus:    { type: "number",  description: "Expected HTTP status (default: 200)." },
        verifyTopic:     { type: "string",  description: "Kafka topic to check for the message." },
        verifySubstring: { type: "string",  description: "Substring to search for in the topic." },
      },
      required: ["url"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "kafka-mi-mcp-server", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const result = await handler(args);
    return { content: [{ type: "text", text: result }] };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Tool '${name}' error:\n${err.message}\n${err.stack ?? ""}`,
        },
      ],
      isError: true,
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[kafka-mi-mcp] Server listening on stdio. Tools: " +
  TOOLS.map(t => t.name).join(", "));
