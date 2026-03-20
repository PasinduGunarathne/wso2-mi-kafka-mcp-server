// src/tools/stack.ts
// start_stack, stop_stack, stack_status, show_logs, reset_environment

import * as docker from "../utils/docker.js";
import { CONTAINERS } from "../utils/docker.js";
import { projectDir } from "../utils/files.js";
import * as log from "../utils/logger.js";

function getDir(p?: string) { return projectDir(p); }

// ─────────────────────────────────────────────────────────────────────────────
export async function startStack(args: { projectPath?: string }): Promise<string> {
  const dir = getDir(args.projectPath);
  const lines: string[] = [];

  lines.push(log.run("Starting Kafka + WSO2 MI stack..."));
  const r = await docker.composeUp(dir);

  if (!r.ok) {
    lines.push(log.err("Failed to start stack:"));
    lines.push(r.stderr.slice(-1500));
    return lines.join("\n");
  }

  lines.push(log.ok("Stack is starting. Containers may need 60-90s to become fully healthy."));
  lines.push("");
  lines.push(log.info("Check status:       stack_status"));
  lines.push(log.info("Watch MI logs:      show_logs {\"service\":\"wso2mi\"}"));
  lines.push(log.info("Run health checks:  run_health_checks"));
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function stopStack(args: { projectPath?: string }): Promise<string> {
  const dir = getDir(args.projectPath);
  const lines: string[] = [];

  lines.push(log.run("Stopping stack (containers stopped, volumes preserved)..."));
  const r = await docker.composeStop(dir);

  if (!r.ok) {
    lines.push(log.err("Stop failed:"));
    lines.push(r.stderr);
    return lines.join("\n");
  }

  lines.push(log.ok("Stack stopped. Data volumes preserved."));
  lines.push(log.info("To restart:  start_stack"));
  lines.push(log.info("To fully reset (delete volumes): reset_environment"));
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function stackStatus(args: { projectPath?: string }): Promise<string> {
  const dir = getDir(args.projectPath);
  const lines: string[] = [];

  lines.push("🔍  Checking stack status...\n");

  // Container status
  const psR = await docker.composePs(dir);

  // Individual health checks
  const checks: Array<{ name: string; fn: () => Promise<boolean> }> = [
    {
      name: "ZooKeeper",
      fn: async () => {
        const r = await docker.exec(CONTAINERS.ZOOKEEPER, ["bash", "-c", "echo ruok | nc localhost 2181"]);
        return r.stdout.trim() === "imok";
      },
    },
    {
      name: "Kafka broker",
      fn: async () => {
        const r = await docker.exec(CONTAINERS.KAFKA, [
          "kafka-topics", "--bootstrap-server", "localhost:9092", "--list",
        ]);
        return r.ok;
      },
    },
    {
      name: "Kafka UI",
      fn: async () => {
        const r = await docker.run("curl", ["-sf", "http://localhost:8090"]);
        return r.ok;
      },
    },
    {
      name: "WSO2 MI (health)",
      fn: async () => {
        const r = await docker.run("curl", ["-sf", "http://localhost:9164/management/health"]);
        return r.ok;
      },
    },
    {
      name: "WSO2 MI (publish API)",
      fn: async () => {
        const r = await docker.run("curl", ["-sf", "http://localhost:8290/kafka/health"]);
        return r.ok;
      },
    },
  ];

  lines.push("Service Health:");
  for (const check of checks) {
    try {
      const healthy = await check.fn();
      lines.push(healthy ? log.ok(check.name) : log.err(`${check.name} — not reachable`));
    } catch {
      lines.push(log.err(`${check.name} — error`));
    }
  }

  lines.push("");
  lines.push("Docker Containers:");
  lines.push(psR.stdout || psR.stderr || "(no output)");

  // Kafka topics
  lines.push("Kafka Topics:");
  const topicsR = await docker.exec(CONTAINERS.KAFKA, [
    "kafka-topics", "--bootstrap-server", "localhost:9092", "--list",
  ]);
  if (topicsR.ok) {
    lines.push(topicsR.stdout || "(no topics)");
  } else {
    lines.push("(Kafka not reachable)");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function showLogs(args: {
  projectPath?: string;
  service?: string;
  tail?: number;
}): Promise<string> {
  const dir   = getDir(args.projectPath);
  const tail  = args.tail ?? 50;
  const svc   = args.service;

  const lines: string[] = [];
  const label = svc ? `'${svc}'` : "all services";
  lines.push(log.info(`Fetching last ${tail} log lines for ${label}...`));
  lines.push("");

  const r = await docker.composeLogs(dir, svc, tail);
  lines.push(r.stdout || r.stderr || "(no output)");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function resetEnvironment(args: {
  projectPath?: string;
  confirm?: boolean;
}): Promise<string> {
  const dir = getDir(args.projectPath);
  const lines: string[] = [];

  if (!args.confirm) {
    return [
      log.warn("This will stop all containers and DELETE all volumes (Kafka data, MI logs)."),
      "",
      "To proceed, call reset_environment with { \"confirm\": true }",
    ].join("\n");
  }

  lines.push(log.run("Resetting environment — stopping containers and removing volumes..."));
  const r = await docker.composeDown(dir);

  if (!r.ok) {
    lines.push(log.warn("docker compose down reported issues (may be fine if containers were already stopped):"));
    lines.push(r.stderr.slice(-500));
  }

  lines.push(log.ok("Environment reset. All containers and volumes removed."));
  lines.push(log.info("Run setup_kafka_and_mi to set up fresh."));
  return lines.join("\n");
}
