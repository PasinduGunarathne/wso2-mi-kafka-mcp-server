#!/usr/bin/env node
/**
 * kafka-mi-mcp-server
 * ───────────────────
 * MCP Server that fully automates a local Kafka + WSO2 Micro Integrator
 * development environment.
 *
 * Just say "setup kafka and mi" in Claude Desktop and this server
 * does everything: installs, configures, starts, and verifies the stack.
 *
 * Tools:
 *   setup_kafka_and_mi   — Full automated setup (the main tool)
 *   start_stack          — Start all Docker containers
 *   stop_stack           — Stop all containers
 *   stack_status         — Check service health
 *   run_demo             — Run end-to-end demo with evidence
 *   trigger_error        — Test error handling (DLQ flow)
 *   check_dlq            — View Dead Letter Queue messages
 *   run_health_checks    — Verify all services
 *   reset_environment    — Clean reset (removes volumes)
 *   show_logs            — View recent logs
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { setupKafkaAndMI }  from "./tools/setup.js";
import { runDemo, runHealthChecks, triggerError, checkDLQ } from "./tools/demo.js";
import {
  startStack,
  stopStack,
  stackStatus,
  showLogs,
  resetEnvironment,
} from "./tools/stack.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "setup_kafka_and_mi",
    description:
      "Fully automated setup of Apache Kafka + WSO2 Micro Integrator. " +
      "Checks prerequisites, generates all config files, builds Docker images, " +
      "starts the stack, creates Kafka topics (demo.orders.in, demo.orders.audit), " +
      "deploys WSO2 MI publish/consume flows, runs a smoke test, and prints a " +
      "success summary. Run this once to get the full stack running. " +
      "Trigger phrases: 'setup kafka and mi', 'start kafka', 'setup integration stack'.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description:
            "Directory where the project will be created. " +
            "Defaults to ~/kafka-mi-demo",
        },
        skipBuild: {
          type: "boolean",
          description:
            "Skip Docker image build (use cached images). Default: false.",
        },
      },
    },
  },
  {
    name: "start_stack",
    description:
      "Start all Docker containers for the Kafka + WSO2 MI stack. " +
      "Use this after stop_stack to restart without re-running the full setup.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Project directory (default: ~/kafka-mi-demo)" },
      },
    },
  },
  {
    name: "stop_stack",
    description:
      "Stop all running containers for the Kafka + WSO2 MI stack. " +
      "Preserves data volumes — use reset_environment to also remove data.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "stack_status",
    description:
      "Show the current status of all Kafka + WSO2 MI services. " +
      "Checks container health, Kafka topics, and WSO2 MI API availability.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "run_demo",
    description:
      "Run an end-to-end demo: publishes a sample order event via the WSO2 MI " +
      "HTTP API, then verifies that Kafka received it, WSO2 MI consumed it, " +
      "and an enriched audit message was produced on demo.orders.audit. " +
      "Provides clear evidence at each step.",
    inputSchema: {
      type: "object",
      properties: {
        orderId:  { type: "string",  description: "Custom order ID (default: auto-generated)" },
        customer: { type: "string",  description: "Customer name (default: Alice)" },
        event:    { type: "string",  description: "Event type (default: order-created)" },
        amount:   { type: "number",  description: "Order amount (default: 125.50)" },
      },
    },
  },
  {
    name: "run_health_checks",
    description:
      "Run all health checks for the Kafka + WSO2 MI stack. " +
      "Checks: ZooKeeper, Kafka broker, Kafka topics, WSO2 MI APIs, " +
      "deployed artifacts. Provides actionable failure messages.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "reset_environment",
    description:
      "Fully reset the environment: stop all containers and remove all volumes " +
      "(Kafka data, MI logs). Requires confirm=true to prevent accidental data loss. " +
      "After reset, run setup_kafka_and_mi to start fresh.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        confirm: {
          type: "boolean",
          description: "Must be true to confirm destruction of all data. Default: false.",
        },
      },
    },
  },
  {
    name: "show_logs",
    description:
      "Show recent logs from the Kafka + WSO2 MI stack. " +
      "Can show all services or a specific one: wso2mi, kafka, zookeeper, kafka-ui.",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          enum: ["wso2mi", "kafka", "zookeeper", "kafka-ui"],
          description: "Service to show logs for. Omit for all services.",
        },
        tail: {
          type: "number",
          description: "Number of log lines to show (default: 50).",
        },
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "trigger_error",
    description:
      "Trigger an error scenario to test the Dead Letter Queue (DLQ) flow. " +
      "Sends a message that will intentionally fail during processing, causing it to be " +
      "routed to demo.orders.dlq via the fault sequence. " +
      "Error types: 'processing' (simulated error), 'missing-id' (validation), 'missing-event' (validation).",
    inputSchema: {
      type: "object",
      properties: {
        errorType: {
          type: "string",
          enum: ["processing", "missing-id", "missing-event"],
          description:
            "Type of error to trigger. " +
            "'processing' sends event='order-error' which triggers a simulated processing failure. " +
            "'missing-id' sends a message without an id field. " +
            "'missing-event' sends a message without an event field. " +
            "Default: 'processing'.",
        },
        orderId: {
          type: "string",
          description: "Custom order ID for the error message (default: auto-generated).",
        },
      },
    },
  },
  {
    name: "check_dlq",
    description:
      "Check the Dead Letter Queue (demo.orders.dlq) for failed messages. " +
      "Shows error details, original payload, and failure reason for each message. " +
      "Use after trigger_error to verify error handling works correctly.",
    inputSchema: {
      type: "object",
      properties: {
        maxMessages: {
          type: "number",
          description: "Maximum number of DLQ messages to read (default: 10).",
        },
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────────────────────
const server = new Server(
  {
    name: "kafka-mi-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: string;

    switch (name) {
      case "setup_kafka_and_mi":
        result = await setupKafkaAndMI(args as any);
        break;
      case "start_stack":
        result = await startStack(args as any);
        break;
      case "stop_stack":
        result = await stopStack(args as any);
        break;
      case "stack_status":
        result = await stackStatus(args as any);
        break;
      case "run_demo":
        result = await runDemo(args as any);
        break;
      case "run_health_checks":
        result = await runHealthChecks(args as any);
        break;
      case "reset_environment":
        result = await resetEnvironment(args as any);
        break;
      case "show_logs":
        result = await showLogs(args as any);
        break;
      case "trigger_error":
        result = await triggerError(args as any);
        break;
      case "check_dlq":
        result = await checkDLQ(args as any);
        break;
      default:
        result = `Unknown tool: ${name}`;
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Tool '${name}' threw an unexpected error:\n${err.message}\n${err.stack ?? ""}`,
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
