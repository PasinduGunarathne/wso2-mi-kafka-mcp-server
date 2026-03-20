// src/tools/diagnostics.ts
// MCP tools: trace_order_flow, collect_stack_diagnostics, smoke_test_custom_flow

import { execa } from "execa";
import * as docker from "../utils/docker.js";
import { CONTAINERS, sleep } from "../utils/docker.js";
import * as kafka from "../services/kafka-service.js";
import * as mi from "../services/mi-service.js";
import * as log from "../utils/logger.js";
import { requireString, optionalPositiveInt } from "../utils/validation.js";
import type { FlowTrace, FlowTraceStep, StackDiagnostics } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
export async function traceOrderFlow(args: {
  orderId?: string;
}): Promise<string> {
  const orderId = requireString(args.orderId, "orderId");
  const lines: string[] = [];
  lines.push(log.header(`Trace Order: ${orderId}`));

  const trace: FlowTrace = {
    orderId,
    steps: [],
    outcome: "not_found",
  };
  const startTime = Date.now();

  // ── Step 1: Check demo.orders.in ────────────────────────────────────────
  lines.push(log.run("[1/4] Checking demo.orders.in..."));
  const inMessages = await kafka.consumeMessages({
    topic: "demo.orders.in",
    maxMessages: 200,
    timeoutMs: 10_000,
    fromBeginning: true,
  });
  const inMatch = inMessages.find((m) => m.value.includes(orderId));

  if (inMatch) {
    trace.steps.push({
      phase: "Published to demo.orders.in",
      status: "ok",
      detail: `Found at partition=${inMatch.partition ?? "?"}, offset=${inMatch.offset ?? "?"}`,
      timestamp: inMatch.timestamp,
    });
    lines.push(log.ok("Found in demo.orders.in"));
  } else {
    trace.steps.push({
      phase: "Published to demo.orders.in",
      status: "error",
      detail: "Message not found in input topic",
    });
    lines.push(log.err("Not found in demo.orders.in"));
  }

  // ── Step 2: Check MI logs for consumption ────────────────────────────────
  lines.push(log.run("[2/4] Checking WSO2 MI consumption logs..."));
  const miLogs = await docker.composeLogs(undefined, "wso2mi", 200);
  const logLines = miLogs.stdout.split("\n");
  const consumeLog = logLines.find((l) => l.includes(orderId) && l.includes("KAFKA-CONSUME"));

  if (consumeLog) {
    trace.steps.push({
      phase: "Consumed by WSO2 MI",
      status: "ok",
      detail: "Consumption evidence found in MI logs",
    });
    lines.push(log.ok("WSO2 MI consumed the message"));
  } else {
    trace.steps.push({
      phase: "Consumed by WSO2 MI",
      status: inMatch ? "warn" : "skipped",
      detail: inMatch ? "No consumption log found (may have been consumed before log window)" : "Skipped — message not in input topic",
    });
    lines.push(inMatch ? log.warn("No consumption log visible") : log.info("Skipped (not in input topic)"));
  }

  // ── Step 3: Check demo.orders.audit ──────────────────────────────────────
  lines.push(log.run("[3/4] Checking demo.orders.audit..."));
  const auditMessages = await kafka.consumeMessages({
    topic: "demo.orders.audit",
    maxMessages: 200,
    timeoutMs: 10_000,
    fromBeginning: true,
  });
  const auditMatch = auditMessages.find((m) => m.value.includes(orderId));

  if (auditMatch) {
    trace.steps.push({
      phase: "Enriched to demo.orders.audit",
      status: "ok",
      detail: `Enriched message found at partition=${auditMatch.partition ?? "?"}, offset=${auditMatch.offset ?? "?"}`,
    });
    lines.push(log.ok("Found in demo.orders.audit (success path)"));
  } else {
    trace.steps.push({
      phase: "Enriched to demo.orders.audit",
      status: "warn",
      detail: "Not found in audit topic",
    });
    lines.push(log.warn("Not found in demo.orders.audit"));
  }

  // ── Step 4: Check DLQ ────────────────────────────────────────────────────
  lines.push(log.run("[4/4] Checking demo.orders.dlq..."));
  const dlqMessages = await kafka.consumeMessages({
    topic: "demo.orders.dlq",
    maxMessages: 200,
    timeoutMs: 10_000,
    fromBeginning: true,
  });
  const dlqMatch = dlqMessages.find((m) => m.value.includes(orderId));

  if (dlqMatch) {
    trace.steps.push({
      phase: "Routed to DLQ",
      status: "error",
      detail: `Failed message found in DLQ: ${dlqMatch.value.slice(0, 200)}`,
    });
    lines.push(log.warn("Found in DLQ (error path)"));
  } else {
    trace.steps.push({
      phase: "DLQ check",
      status: "ok",
      detail: "Not in DLQ (good — no errors)",
    });
    lines.push(log.ok("Not in DLQ"));
  }

  // ── Determine outcome ────────────────────────────────────────────────────
  trace.durationMs = Date.now() - startTime;

  if (inMatch && auditMatch && !dlqMatch) {
    trace.outcome = "success";
  } else if (dlqMatch) {
    trace.outcome = "error";
  } else if (inMatch) {
    trace.outcome = "partial";
  } else {
    trace.outcome = "not_found";
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("─── Trace Summary ─────────────────────────────────────────────");
  const outcomeLabels: Record<string, string> = {
    success: "SUCCESS — Full flow completed",
    error: "ERROR — Message routed to DLQ",
    partial: "PARTIAL — Published but not fully processed",
    not_found: "NOT FOUND — Order ID not found in any topic",
  };
  lines.push(`  Order ID: ${orderId}`);
  lines.push(`  Outcome:  ${outcomeLabels[trace.outcome]}`);
  lines.push(`  Trace took: ${trace.durationMs}ms`);
  lines.push("");

  lines.push("  Steps:");
  for (const step of trace.steps) {
    const icon = step.status === "ok" ? "✅" : step.status === "warn" ? "⚠️" : step.status === "error" ? "❌" : "⏭️";
    lines.push(`    ${icon} ${step.phase}: ${step.detail}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function collectStackDiagnostics(): Promise<string> {
  const lines: string[] = [];
  lines.push(log.header("Stack Diagnostics"));

  const diag: StackDiagnostics = {
    containers: [],
    topics: [],
    miApis: [],
    recentErrors: [],
  };

  // ── Containers ──────────────────────────────────────────────────────────
  lines.push(log.run("Checking containers..."));
  const containerNames = [CONTAINERS.ZOOKEEPER, CONTAINERS.KAFKA, CONTAINERS.KAFKA_UI, CONTAINERS.WSO2MI];

  for (const name of containerNames) {
    const r = await docker.run("docker", [
      "inspect", "--format", "{{.State.Status}}|{{.State.Health.Status}}", name,
    ]);
    if (r.ok) {
      const [status, health] = r.stdout.trim().split("|");
      const healthy = health === "healthy" || (status === "running" && health === "");
      diag.containers.push({ name, status, healthy });
      lines.push(healthy ? log.ok(`${name}: ${status}`) : log.warn(`${name}: ${status} (health: ${health})`));
    } else {
      diag.containers.push({ name, status: "not found", healthy: false });
      lines.push(log.err(`${name}: not found`));
    }
  }

  // ── Topics ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(log.run("Checking Kafka topics..."));
  try {
    diag.topics = await kafka.listTopics();
    lines.push(log.ok(`${diag.topics.length} topic(s): ${diag.topics.join(", ")}`));
  } catch (e: any) {
    lines.push(log.err(`Cannot list topics: ${e.message}`));
  }

  // ── MI APIs ─────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(log.run("Checking deployed MI artifacts..."));
  try {
    diag.miApis = await mi.listDeployedApis();
    lines.push(log.ok(`APIs: ${diag.miApis.join(", ") || "(none)"}`));
  } catch (e: any) {
    lines.push(log.warn(`Cannot query MI APIs: ${e.message}`));
  }

  const sequences = await mi.listSequences();
  lines.push(log.info(`Sequences: ${sequences.join(", ") || "(none)"}`));

  const inbounds = await mi.listInboundEndpoints();
  lines.push(log.info(`Inbound endpoints: ${inbounds.join(", ") || "(none)"}`));

  // ── Recent errors ───────────────────────────────────────────────────────
  lines.push("");
  lines.push(log.run("Checking recent errors..."));
  diag.recentErrors = await mi.getRecentErrors();
  if (diag.recentErrors.length === 0) {
    lines.push(log.ok("No recent errors in MI logs."));
  } else {
    lines.push(log.warn(`${diag.recentErrors.length} recent error/warning lines:`));
    diag.recentErrors.slice(-10).forEach((e) => lines.push(`  ${e.trim()}`));
  }

  // ── Disk usage ──────────────────────────────────────────────────────────
  lines.push("");
  lines.push(log.run("Checking Docker disk usage..."));
  const dfR = await docker.run("docker", ["system", "df", "--format", "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"], undefined, 15_000);
  if (dfR.ok) {
    diag.diskUsage = dfR.stdout;
    lines.push(dfR.stdout);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  lines.push("");
  const healthyCount = diag.containers.filter((c) => c.healthy).length;
  lines.push("─── Summary ───────────────────────────────────────────────────");
  lines.push(`  Containers: ${healthyCount}/${diag.containers.length} healthy`);
  lines.push(`  Topics:     ${diag.topics.length}`);
  lines.push(`  MI APIs:    ${diag.miApis.length}`);
  lines.push(`  Errors:     ${diag.recentErrors.length}`);

  if (healthyCount === diag.containers.length && diag.recentErrors.length === 0) {
    lines.push("");
    lines.push(log.done("Stack is healthy."));
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function smokeTestCustomFlow(args: {
  url?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  expectStatus?: number;
  verifyTopic?: string;
  verifySubstring?: string;
}): Promise<string> {
  const url = requireString(args.url, "url");
  const method = (args.method ?? "POST").toUpperCase();
  const lines: string[] = [];
  lines.push(log.header("Smoke Test: Custom Flow"));

  // ── Step 1: Send HTTP request ───────────────────────────────────────────
  lines.push(log.run(`[1/3] ${method} ${url}...`));

  const curlArgs = [
    "-s", "-w", "\n%{http_code}",
    "-X", method,
    url,
    "--max-time", "15",
  ];

  if (args.body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    curlArgs.push("-d", args.body);
    curlArgs.push("-H", "Content-Type: application/json");
  }

  if (args.headers) {
    for (const [k, v] of Object.entries(args.headers)) {
      curlArgs.push("-H", `${k}: ${v}`);
    }
  }

  const httpR = await docker.run("curl", curlArgs, undefined, 20_000);

  // Parse response: body is everything except last line (status code)
  const httpLines = httpR.stdout.split("\n");
  const statusCode = parseInt(httpLines[httpLines.length - 1], 10) || 0;
  const responseBody = httpLines.slice(0, -1).join("\n");

  const expectedStatus = args.expectStatus ?? 200;
  if (statusCode === expectedStatus) {
    lines.push(log.ok(`HTTP ${statusCode} (expected ${expectedStatus})`));
  } else if (statusCode > 0) {
    lines.push(log.err(`HTTP ${statusCode} (expected ${expectedStatus})`));
  } else {
    lines.push(log.err(`Request failed: ${httpR.stderr}`));
    return lines.join("\n");
  }
  lines.push(log.info(`Response: ${responseBody.slice(0, 500)}`));
  lines.push("");

  // ── Step 2: Verify in Kafka topic (optional) ───────────────────────────
  if (args.verifyTopic) {
    lines.push(log.run(`[2/3] Verifying message in '${args.verifyTopic}'...`));
    await sleep(3000);

    const messages = await kafka.consumeMessages({
      topic: args.verifyTopic,
      maxMessages: 50,
      timeoutMs: 10_000,
      fromBeginning: true,
    });

    if (args.verifySubstring) {
      const match = messages.find((m) =>
        m.value.toLowerCase().includes(args.verifySubstring!.toLowerCase())
      );
      if (match) {
        lines.push(log.ok(`Found message containing "${args.verifySubstring}" in '${args.verifyTopic}'`));
        lines.push(log.info(`Message: ${match.value.slice(0, 300)}`));
      } else {
        lines.push(log.err(`No message containing "${args.verifySubstring}" in '${args.verifyTopic}'`));
      }
    } else {
      lines.push(log.ok(`${messages.length} message(s) in '${args.verifyTopic}'`));
    }
  } else {
    lines.push(log.info("[2/3] No verifyTopic specified — skipping Kafka check."));
  }
  lines.push("");

  // ── Step 3: Quick MI health check ──────────────────────────────────────
  lines.push(log.run("[3/3] Quick MI health check..."));
  const healthR = await docker.run("curl", ["-sf", "http://localhost:9164/management/health"], undefined, 5_000);
  if (healthR.ok) {
    lines.push(log.ok("WSO2 MI is healthy"));
  } else {
    lines.push(log.warn("WSO2 MI health check failed"));
  }

  lines.push("");
  lines.push(log.done("Smoke test complete."));

  return lines.join("\n");
}
