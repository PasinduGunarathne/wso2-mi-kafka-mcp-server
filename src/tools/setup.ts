// src/tools/setup.ts
// The main "setup_kafka_and_mi" tool — fully automated end-to-end setup.

import path from "path";
import * as docker from "../utils/docker.js";
import { CONTAINERS } from "../utils/docker.js";
import { generateProjectFiles, projectDir } from "../utils/files.js";
import * as log from "../utils/logger.js";

const TOTAL_STEPS = 10;

export async function setupKafkaAndMI(args: {
  projectPath?: string;
  skipBuild?: boolean;
}): Promise<string> {
  const lines: string[] = [];
  const out = (s: string) => { lines.push(s); };

  const dir = projectDir(args.projectPath);

  out(log.header("🚀  Kafka + WSO2 MI — Automated Setup"));
  out(log.info(`Project directory: ${dir}`));
  out("");

  // ── STEP 1: Prerequisites ─────────────────────────────────────────────────
  out(log.step(1, TOTAL_STEPS, "Checking prerequisites..."));
  const prereqs = ["docker", "curl"];
  for (const bin of prereqs) {
    const found = await docker.which(bin);
    if (!found) {
      return lines.join("\n") + "\n\n" +
        log.err(`'${bin}' not found on PATH.\nPlease install Docker Desktop or Rancher Desktop and try again.`);
    }
    out(log.ok(`${bin} found`));
  }
  const composeCheck = await docker.run("docker", ["compose", "version"]);
  if (!composeCheck.ok) {
    return lines.join("\n") + "\n\n" +
      log.err("Docker Compose v2 not found.\nEnsure you have Docker Desktop, Rancher Desktop, or the compose plugin installed.");
  }
  out(log.ok(`docker compose ${composeCheck.stdout.match(/v[\d.]+/)?.[0] ?? "v2"} found`));
  out("");

  // ── STEP 2: Generate project files ────────────────────────────────────────
  out(log.step(2, TOTAL_STEPS, "Generating project files..."));
  const created = await generateProjectFiles(dir);
  out(log.ok(`Created ${created.length} files in ${dir}`));
  out(log.info("Key files:"));
  out("    docker-compose.yml");
  out("    wso2mi/Dockerfile.dockerhub (downloads Kafka connector JARs)");
  out("    wso2mi/conf/deployment.toml");
  out("    wso2mi/artifacts/apis/KafkaPublisherAPI.xml");
  out("    wso2mi/artifacts/inbound-endpoints/KafkaOrderConsumer.xml");
  out("    wso2mi/artifacts/sequences/kafkaOrderProcessingSequence.xml");
  out("    wso2mi/artifacts/sequences/kafkaFaultSequence.xml");
  out("");

  // ── STEP 3: Pull base images ──────────────────────────────────────────────
  out(log.step(3, TOTAL_STEPS, "Pulling Docker base images..."));
  out(log.wait("Pulling base images..."));
  for (const img of ["wso2/wso2mi:4.4.0", "confluentinc/cp-zookeeper:7.6.1", "confluentinc/cp-kafka:7.6.1"]) {
    const r = await docker.pullImage(img);
    if (r.ok) out(log.ok(`Pulled ${img}`));
    else out(log.warn(`Pull may have failed for ${img} (might already be cached)`));
  }
  out("");

  // ── STEP 4: Build WSO2 MI image ────────────────────────────────────────────
  out(log.step(4, TOTAL_STEPS, "Building WSO2 MI image with Kafka connector..."));
  out(log.wait("This downloads the Kafka connector CAR + inbound endpoint JAR. ~2-4 min on first run."));

  if (!args.skipBuild) {
    const buildR = await docker.run(
      "docker",
      ["compose", "build", "--progress=plain", "wso2mi"],
      dir
    );
    if (!buildR.ok) {
      out(log.err("WSO2 MI image build failed."));
      out("Build output:");
      out(buildR.stderr.slice(-2000)); // last 2000 chars
      return lines.join("\n");
    }
    out(log.ok("WSO2 MI image built successfully"));
  } else {
    out(log.info("Skipping build (skipBuild=true)"));
  }
  out("");

  // ── STEP 5: Start containers ──────────────────────────────────────────────
  out(log.step(5, TOTAL_STEPS, "Starting all containers..."));
  const upR = await docker.composeUp(dir);
  if (!upR.ok) {
    out(log.err("docker compose up failed:"));
    out(upR.stderr.slice(-1500));
    return lines.join("\n");
  }
  out(log.ok("Containers started"));
  out("");

  // ── STEP 6: Wait for Kafka ────────────────────────────────────────────────
  out(log.step(6, TOTAL_STEPS, "Waiting for Kafka broker to be healthy (up to 120s)..."));
  const kafkaReady = await docker.waitUntilHealthy(
    CONTAINERS.KAFKA,
    ["kafka-topics", "--bootstrap-server", "localhost:9092", "--list"],
    120_000,
    4_000
  );
  if (!kafkaReady) {
    out(log.err("Kafka did not become healthy in time."));
    const logs = await docker.composeLogs(dir, "kafka", 30);
    out("Kafka logs:\n" + logs.stdout);
    return lines.join("\n");
  }
  out(log.ok("Kafka is ready on localhost:9092"));
  out("");

  // ── STEP 7: Create topics ─────────────────────────────────────────────────
  out(log.step(7, TOTAL_STEPS, "Creating Kafka topics..."));
  for (const topic of ["demo.orders.in", "demo.orders.audit", "demo.orders.dlq"]) {
    const r = await docker.exec(CONTAINERS.KAFKA, [
      "kafka-topics",
      "--bootstrap-server", "localhost:9092",
      "--create", "--if-not-exists",
      "--topic", topic,
      "--partitions", "3",
      "--replication-factor", "1",
    ]);
    if (r.ok) {
      out(log.ok(`Topic '${topic}' created`));
    } else {
      out(log.warn(`Topic creation may have failed for '${topic}': ${r.stderr}`));
    }
  }
  out("");

  // ── STEP 8: Wait for WSO2 MI ──────────────────────────────────────────────
  out(log.step(8, TOTAL_STEPS, "Waiting for WSO2 MI to be healthy (up to 180s)..."));
  out(log.info("WSO2 MI startup takes ~60-90s on first run (JVM warm-up + artifact deploy)"));

  const miReady = await docker.waitUntilHealthy(
    CONTAINERS.WSO2MI,
    ["curl", "-sf", "http://localhost:9164/management/health"],
    180_000,
    8_000
  );
  if (!miReady) {
    out(log.warn("WSO2 MI may still be starting. Checking container status..."));
    const ps = await docker.composePs(dir);
    out(ps.stdout);
    out(log.info("Try: run_health_checks in a few minutes to re-verify."));
  } else {
    out(log.ok("WSO2 MI is ready on localhost:8290"));
  }
  out("");

  // ── STEP 9: Smoke test ────────────────────────────────────────────────────
  out(log.step(9, TOTAL_STEPS, "Running smoke test..."));
  if (miReady) {
    const smokeResult = await smokePub();
    if (smokeResult.ok) {
      out(log.ok("Smoke test PASSED — event published successfully"));
      out(log.info(`Response: ${smokeResult.response}`));
    } else {
      out(log.warn(`Smoke test failed: ${smokeResult.error}`));
      out(log.info("The stack may need a few more seconds. Run run_demo later."));
    }
  } else {
    out(log.warn("Skipping smoke test — WSO2 MI not yet ready"));
  }
  out("");

  // ── STEP 10: Summary ──────────────────────────────────────────────────────
  out(log.step(10, TOTAL_STEPS, "Done!"));
  out(log.done("Setup complete! Here is your stack:"));
  out("");
  out(log.box([
    "📡  Services",
    "",
    "  Kafka broker:       localhost:9092",
    "  Kafka UI:           http://localhost:8090",
    "  WSO2 MI HTTP API:   http://localhost:8290",
    "  WSO2 MI Mgmt API:   http://localhost:9164",
    "",
    "📬  Kafka Topics",
    "  demo.orders.in     ← publish here",
    "  demo.orders.audit  ← consumed + enriched events",
    "  demo.orders.dlq    ← dead letter queue (failed messages)",
    "",
    "🔧  Useful commands",
    "  Publish event:  scripts/test-publish.sh",
    "  Check topics:   scripts/test-consume.sh",
    "  Full verify:    scripts/verify-stack.sh",
    "  View MI logs:   docker compose logs -f wso2mi | grep KAFKA",
    "",
    "💡  MCP tools available: run_demo · trigger_error · check_dlq · run_health_checks · show_logs",
  ]));
  out("");
  out(log.info("Let's verify the full flow. Try: run_demo"));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
async function smokePub(): Promise<{ ok: boolean; response?: string; error?: string }> {
  try {
    const { execa } = await import("execa");
    const r = await execa("curl", [
      "-sf", "-X", "POST",
      "http://localhost:8290/kafka/publish",
      "-H", "Content-Type: application/json",
      "--max-time", "10",
      "-d", JSON.stringify({
        id: "smoke-001",
        customer: "SetupSmoke",
        event: "order-created",
        amount: 1.0,
      }),
    ], { reject: false, timeout: 15_000 });
    if (r.exitCode === 0 && r.stdout.includes("published")) {
      return { ok: true, response: r.stdout };
    }
    return { ok: false, error: r.stderr || r.stdout };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
