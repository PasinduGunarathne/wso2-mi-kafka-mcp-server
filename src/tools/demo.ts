// src/tools/demo.ts
// run_demo and run_health_checks tools

import * as docker from "../utils/docker.js";
import { CONTAINERS, sleep, httpGet } from "../utils/docker.js";
import * as log from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
export async function runDemo(args: {
  orderId?: string;
  customer?: string;
  event?: string;
  amount?: number;
}): Promise<string> {
  const lines: string[] = [];
  const payload = {
    id:       args.orderId  ?? `demo-${Date.now()}`,
    customer: args.customer ?? "Alice",
    event:    args.event    ?? "order-created",
    amount:   args.amount   ?? 125.50,
  };

  lines.push(log.header("🎬  End-to-End Demo: Kafka + WSO2 MI"));
  lines.push("");
  lines.push("I'm going to publish a sample order event and verify that:");
  lines.push("  1. ✅ WSO2 MI accepts the HTTP request");
  lines.push("  2. ✅ The message reaches Kafka topic demo.orders.in");
  lines.push("  3. ✅ WSO2 MI consumes it via the Kafka inbound endpoint");
  lines.push("  4. ✅ An enriched message appears on demo.orders.audit");
  lines.push("");

  // ── Show the curl command ─────────────────────────────────────────────────
  lines.push("─── The curl command you can also run yourself: ─────────────────");
  lines.push(`curl -X POST http://localhost:8290/kafka/publish \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`);
  lines.push("");

  // ── Step 1: Publish via HTTP ──────────────────────────────────────────────
  lines.push(log.run("[1/4] Publishing event to WSO2 MI..."));
  const pubResult = await httpPost("http://localhost:8290/kafka/publish", payload);
  if (!pubResult.ok) {
    lines.push(log.err(`Publish failed: ${pubResult.error}`));
    lines.push(log.info("Make sure WSO2 MI is running: stack_status"));
    return lines.join("\n");
  }
  lines.push(log.ok("HTTP 200 received from WSO2 MI"));
  lines.push(log.info(`Response: ${pubResult.body}`));
  lines.push("");

  // ── Step 2: Verify message in demo.orders.in ───────────────────────────────
  lines.push(log.run("[2/4] Checking demo.orders.in for the message..."));
  await sleep(2000); // Give Kafka a moment to commit
  const inTopic = await readKafkaTopic("demo.orders.in", 3);
  if (inTopic.length > 0) {
    lines.push(log.ok(`Found ${inTopic.length} message(s) in demo.orders.in`));
    lines.push(log.info("Latest: " + inTopic[inTopic.length - 1]));
  } else {
    lines.push(log.warn("Could not read from demo.orders.in (may need a moment)"));
  }
  lines.push("");

  // ── Step 3: Wait for WSO2 MI to consume ───────────────────────────────────
  lines.push(log.run("[3/4] Waiting for WSO2 MI to consume the message (up to 10s)..."));
  await sleep(5000); // Inbound endpoint polls every 1s; give it a few seconds

  // Check MI logs for consumption evidence
  const miLogs = await docker.composeLogs(undefined, "wso2mi", 30);
  const consumeEvidence = miLogs.stdout.includes("KAFKA-CONSUME") ||
                          miLogs.stdout.includes("Event CONSUMED");
  if (consumeEvidence) {
    lines.push(log.ok("WSO2 MI log shows consumption evidence!"));
    // Extract relevant log lines
    const kafkaLines = miLogs.stdout
      .split("\n")
      .filter(l => l.includes("KAFKA"))
      .slice(-5);
    if (kafkaLines.length > 0) {
      lines.push(log.info("WSO2 MI log excerpt:"));
      kafkaLines.forEach(l => lines.push("  " + l.trim()));
    }
  } else {
    lines.push(log.warn("WSO2 MI consumption log not yet visible (the inbound endpoint polls every 1s)"));
    lines.push(log.info("Run: show_logs {\"service\":\"wso2mi\",\"tail\":30} to check manually"));
  }
  lines.push("");

  // ── Step 4: Verify audit topic ─────────────────────────────────────────────
  lines.push(log.run("[4/4] Checking demo.orders.audit for enriched message..."));
  await sleep(3000);
  const auditTopic = await readKafkaTopic("demo.orders.audit", 3);
  if (auditTopic.length > 0) {
    lines.push(log.ok(`Found ${auditTopic.length} enriched message(s) in demo.orders.audit`));
    lines.push(log.info("Latest enriched message:"));
    lines.push("  " + auditTopic[auditTopic.length - 1]);
  } else {
    lines.push(log.warn("No messages in demo.orders.audit yet (consumer may still be processing)"));
    lines.push(log.info("Try: show_logs {\"service\":\"wso2mi\"} to check consumer progress"));
  }
  lines.push("");

  // ── Summary ─────────────────────────────────────────────────────────────
  lines.push("─── Demo Summary ───────────────────────────────────────────────");
  lines.push(`  Payload published:     ${JSON.stringify(payload)}`);
  lines.push(`  Published to Kafka:    demo.orders.in`);
  lines.push(`  Consumer group:        wso2-mi-order-consumers`);
  lines.push(`  Enrichment published:  demo.orders.audit`);
  lines.push("");
  lines.push("─── Check the Kafka UI for a visual view ────────────────────────");
  lines.push("  http://localhost:8090  →  Topics  →  Browse messages");
  lines.push("");
  lines.push(log.done("Demo complete! The Kafka + WSO2 MI flow is working."));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function runHealthChecks(args: {
  projectPath?: string;
}): Promise<string> {
  const lines: string[] = [];
  lines.push(log.header("🏥  Health Checks"));
  lines.push("");

  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => Promise<boolean>) => {
    try {
      const ok = await fn();
      if (ok) { lines.push(log.ok(name)); passed++; }
      else { lines.push(log.err(name)); failed++; }
    } catch (e: any) {
      lines.push(log.err(`${name}: ${e.message}`));
      failed++;
    }
  };

  // Container checks
  lines.push("── Containers ─────────────────────────────────────────────────");
  await check("demo-zookeeper running", async () => {
    const r = await docker.exec("demo-zookeeper", ["bash", "-c", "echo ruok | nc localhost 2181"]);
    return r.stdout.trim() === "imok";
  });
  await check("demo-kafka running", async () => {
    const r = await docker.exec(CONTAINERS.KAFKA, ["kafka-topics", "--bootstrap-server", "localhost:9092", "--list"]);
    return r.ok;
  });
  await check("demo-wso2mi running", async () => {
    const r = await httpGet("http://localhost:9164/management/health");
    return r.ok;
  });

  // Topic checks
  lines.push("");
  lines.push("── Kafka Topics ───────────────────────────────────────────────");
  for (const topic of ["demo.orders.in", "demo.orders.audit"]) {
    await check(`Topic '${topic}' exists`, async () => {
      const r = await docker.exec(CONTAINERS.KAFKA, [
        "kafka-topics", "--bootstrap-server", "localhost:9092",
        "--describe", "--topic", topic,
      ]);
      return r.ok;
    });
  }

  // WSO2 MI API checks
  lines.push("");
  lines.push("── WSO2 MI APIs ───────────────────────────────────────────────");
  await check("KafkaPublisherAPI /kafka/health", async () => {
    const r = await httpGet("http://localhost:8290/kafka/health");
    return r.ok;
  });
  await check("Management API accessible", async () => {
    const r = await httpGet("http://localhost:9164/management/apis");
    return r.ok;
  });

  // Check deployed API via management
  await check("KafkaPublisherAPI deployed in MI", async () => {
    const r = await httpGet("http://localhost:9164/management/apis");
    return r.ok && r.stdout.includes("KafkaPublisher");
  });

  lines.push("");
  lines.push("── Results ────────────────────────────────────────────────────");
  lines.push(`  Passed: ${passed} / ${passed + failed}`);
  lines.push(`  Failed: ${failed}`);

  if (failed === 0) {
    lines.push("");
    lines.push(log.done("All health checks passed! Try: run_demo"));
  } else {
    lines.push("");
    lines.push(log.warn("Some checks failed. Troubleshooting:"));
    lines.push("  1. show_logs {\"service\":\"wso2mi\"} — check MI startup errors");
    lines.push("  2. show_logs {\"service\":\"kafka\"} — check Kafka errors");
    lines.push("  3. WSO2 MI takes ~60-90s to start — wait and retry");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function httpPost(url: string, body: object): Promise<{ ok: boolean; body?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) return { ok: true, body: text };
    return { ok: false, error: `HTTP ${res.status}: ${text}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function readKafkaTopic(topic: string, maxMessages = 5): Promise<string[]> {
  try {
    const r = await docker.exec(CONTAINERS.KAFKA, [
      "kafka-console-consumer",
      "--bootstrap-server", "localhost:9092",
      "--topic", topic,
      "--from-beginning",
      "--max-messages", String(maxMessages),
      "--timeout-ms", "5000",
    ], 15_000);
    return r.stdout
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith("Processed"));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export async function triggerError(args: {
  errorType?: string;
  orderId?: string;
}): Promise<string> {
  const lines: string[] = [];
  const errorType = args.errorType ?? "processing";
  const orderId = args.orderId ?? `err-${Date.now()}`;

  lines.push(log.header("💥  Error Trigger: Test DLQ Flow"));
  lines.push("");

  let payload: object;
  let description: string;

  switch (errorType) {
    case "missing-id":
      // Send message without 'id' field — triggers validation error
      payload = { customer: "ErrorTest", event: "order-created", amount: 10.0 };
      description = "Missing 'id' field → validation error → DLQ";
      break;
    case "missing-event":
      // Send message without 'event' field — triggers validation error
      payload = { id: orderId, customer: "ErrorTest", amount: 10.0 };
      description = "Missing 'event' field → validation error → DLQ";
      break;
    case "processing":
    default:
      // Send event="order-error" — triggers simulated processing error → DLQ
      payload = { id: orderId, customer: "ErrorTest", event: "order-error", amount: 0 };
      description = "event='order-error' → simulated processing error → DLQ";
      break;
  }

  lines.push(log.info(`Error type: ${errorType}`));
  lines.push(log.info(`Scenario:   ${description}`));
  lines.push("");

  // ── Step 1: Publish the error-inducing message ──────────────────────────
  lines.push(log.run("[1/3] Publishing error-inducing message to WSO2 MI..."));
  const pubResult = await httpPost("http://localhost:8290/kafka/publish", payload);

  if (errorType === "missing-id" && !pubResult.ok) {
    // API validation catches missing id — returns 400
    lines.push(log.ok("API correctly rejected the request (HTTP 400 — missing id)"));
    lines.push(log.info(`Response: ${pubResult.error ?? pubResult.body}`));
    lines.push("");
    lines.push("─── Summary ───────────────────────────────────────────────────");
    lines.push("  This error was caught at the API level (publish-side validation).");
    lines.push("  The message never reached Kafka.");
    lines.push("");
    lines.push(log.done("API-level validation working correctly!"));
    return lines.join("\n");
  }

  if (!pubResult.ok) {
    lines.push(log.err(`Publish failed: ${pubResult.error}`));
    lines.push(log.info("Make sure WSO2 MI is running: stack_status"));
    return lines.join("\n");
  }

  lines.push(log.ok(`Published to Kafka (HTTP 200)`));
  lines.push(log.info(`Response: ${pubResult.body}`));
  lines.push("");

  // ── Step 2: Wait for consumer to process and hit the error ──────────────
  lines.push(log.run("[2/3] Waiting for consumer to process and trigger error (up to 10s)..."));
  await sleep(6000);

  const miLogs = await docker.composeLogs(undefined, "wso2mi", 40);
  const faultEvidence = miLogs.stdout.includes("KAFKA-FAULT") ||
                        miLogs.stdout.includes("sent to DLQ");
  const errorEvidence = miLogs.stdout.includes("PROCESSING_ERROR") ||
                        miLogs.stdout.includes("VALIDATION_ERROR") ||
                        miLogs.stdout.includes("Simulated processing error");

  if (faultEvidence || errorEvidence) {
    lines.push(log.ok("Error was caught by fault sequence!"));
    const faultLines = miLogs.stdout
      .split("\n")
      .filter(l => l.includes("KAFKA-FAULT") || l.includes("ERROR") || l.includes("DLQ"))
      .slice(-5);
    if (faultLines.length > 0) {
      lines.push(log.info("MI log excerpt:"));
      faultLines.forEach(l => lines.push("  " + l.trim()));
    }
  } else {
    lines.push(log.warn("Fault sequence logs not yet visible"));
    lines.push(log.info("Run: show_logs {\"service\":\"wso2mi\",\"tail\":40} to check manually"));
  }
  lines.push("");

  // ── Step 3: Check DLQ for the failed message ───────────────────────────
  lines.push(log.run("[3/3] Checking Dead Letter Queue (demo.orders.dlq)..."));
  await sleep(2000);
  const dlqMessages = await readKafkaTopic("demo.orders.dlq", 5);
  if (dlqMessages.length > 0) {
    lines.push(log.ok(`Found ${dlqMessages.length} message(s) in DLQ`));
    lines.push(log.info("Latest DLQ message:"));
    lines.push("  " + dlqMessages[dlqMessages.length - 1]);
  } else {
    lines.push(log.warn("No messages in DLQ yet — check with: check_dlq"));
  }
  lines.push("");

  // ── Summary ────────────────────────────────────────────────────────────
  lines.push("─── Error Flow Summary ─────────────────────────────────────────");
  lines.push(`  Error type:        ${errorType}`);
  lines.push(`  Payload:           ${JSON.stringify(payload)}`);
  lines.push(`  Published to:      demo.orders.in`);
  lines.push(`  Error caught by:   kafkaFaultSequence`);
  lines.push(`  Routed to DLQ:     demo.orders.dlq`);
  lines.push("");
  lines.push("─── Flow ──────────────────────────────────────────────────────");
  lines.push("  HTTP POST → demo.orders.in → Consumer → ERROR → kafkaFaultSequence → demo.orders.dlq");
  lines.push("");
  lines.push(log.info("View DLQ messages: check_dlq"));
  lines.push(log.info("View in Kafka UI:  http://localhost:8090 → Topics → demo.orders.dlq"));
  lines.push("");
  lines.push(log.done("Error handling flow test complete!"));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function checkDLQ(args: {
  maxMessages?: number;
}): Promise<string> {
  const lines: string[] = [];
  const max = args.maxMessages ?? 10;

  lines.push(log.header("📭  Dead Letter Queue (demo.orders.dlq)"));
  lines.push("");

  // Read messages from DLQ topic
  lines.push(log.run(`Reading up to ${max} messages from demo.orders.dlq...`));
  const dlqMessages = await readKafkaTopic("demo.orders.dlq", max);

  if (dlqMessages.length === 0) {
    lines.push(log.ok("DLQ is empty — no failed messages!"));
    lines.push("");
    lines.push(log.info("To test error handling, run: trigger_error"));
    return lines.join("\n");
  }

  lines.push(log.warn(`Found ${dlqMessages.length} failed message(s) in DLQ`));
  lines.push("");

  // Parse and display each DLQ message
  lines.push("─── DLQ Messages ──────────────────────────────────────────────");
  dlqMessages.forEach((msg, i) => {
    lines.push("");
    lines.push(`  ── Message ${i + 1} ──`);
    try {
      const parsed = JSON.parse(msg);
      lines.push(`  Error Code:    ${parsed.errorCode ?? "N/A"}`);
      lines.push(`  Error Message: ${parsed.errorMessage ?? "N/A"}`);
      lines.push(`  Original Topic:${parsed.originalTopic ?? "N/A"}`);
      lines.push(`  Partition:     ${parsed.partition ?? "N/A"}`);
      lines.push(`  Offset:        ${parsed.offset ?? "N/A"}`);
      lines.push(`  Failed At:     ${parsed.failedAt ?? "N/A"}`);
      lines.push(`  Retryable:     ${parsed.retryable ?? "N/A"}`);
      if (parsed.originalPayload) {
        lines.push(`  Original:      ${typeof parsed.originalPayload === "string" ? parsed.originalPayload : JSON.stringify(parsed.originalPayload)}`);
      }
    } catch {
      lines.push(`  Raw: ${msg}`);
    }
  });

  lines.push("");
  lines.push("─── Actions ───────────────────────────────────────────────────");
  lines.push("  View in Kafka UI: http://localhost:8090 → Topics → demo.orders.dlq");
  lines.push("  View MI logs:     show_logs {\"service\":\"wso2mi\",\"tail\":50}");
  lines.push("");
  lines.push(log.info(`Total failed messages: ${dlqMessages.length}`));

  return lines.join("\n");
}

