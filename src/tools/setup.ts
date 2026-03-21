// src/tools/setup.ts
// The main "setup_kafka_and_mi" tool — fully automated end-to-end setup.
//
// Flow:
//   1. User says "setup kafka and mi" (no miSource) → returns option menu
//   2. User picks an option → Claude calls again with miSource + miVersion → full setup runs

import path from "path";
import * as docker from "../utils/docker.js";
import { CONTAINERS } from "../utils/docker.js";
import { generateProjectFiles, projectDir, getProjectRoot } from "../utils/files.js";
import {
  sourceToDockerfile, detectLocalZips, writeConfig, formatConfig,
  DOCKERHUB_VERSIONS, DOCKERHUB_VARIANTS,
  type MiSource, type MiConfig,
} from "../utils/config.js";
import * as log from "../utils/logger.js";

const TOTAL_STEPS = 10;

export async function setupKafkaAndMI(args: {
  projectPath?: string;
  skipBuild?: boolean;
  miSource?: MiSource;
  miVersion?: string;
  // Backward compat — old callers may still pass miDockerfile
  miDockerfile?: string;
}): Promise<string> {
  const lines: string[] = [];
  const out = (s: string) => { lines.push(s); };

  const dir = projectDir(args.projectPath);

  // ── Resolve MI source ───────────────────────────────────────────────────
  // If miSource is provided (or legacy miDockerfile), proceed to setup.
  // If neither is provided, show the option menu and stop.
  let miSource: MiSource | undefined;
  if (args.miSource) {
    miSource = args.miSource;
  } else if (args.miDockerfile) {
    miSource = args.miDockerfile === "Dockerfile" ? "local" : "dockerhub";
  }

  // ── No source chosen → show interactive option menu ─────────────────────
  if (!miSource) {
    return await showOptionMenu(dir, out, lines);
  }

  // ── Source chosen → run full setup ──────────────────────────────────────
  return await runFullSetup(dir, miSource, args, out, lines);
}

// ─────────────────────────────────────────────────────────────────────────────
// Option menu — returned when user hasn't chosen a source yet
// ─────────────────────────────────────────────────────────────────────────────
async function showOptionMenu(
  dir: string,
  out: (s: string) => void,
  lines: string[],
): Promise<string> {
  out(log.header("🚀  Kafka + WSO2 MI — Setup"));
  out("");
  out("Before we begin, choose how to provide the WSO2 Micro Integrator:");
  out("");

  // Option A: Docker Hub
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("  Option A:  Docker Hub image  (recommended — no downloads needed)");
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("");
  out("  Pulls the official WSO2 MI image from Docker Hub.");
  out("  No local files required. Works out of the box.");
  out("");
  out("  Available versions:");
  for (const ver of DOCKERHUB_VERSIONS) {
    const variants = DOCKERHUB_VARIANTS.map(v => `${ver}${v}`).join(", ");
    out(`    • ${ver}   (variants: ${variants})`);
  }
  out("");
  out("  To choose this option, reply with something like:");
  out('    "Use Docker Hub image"');
  out('    "Use Docker Hub MI version 4.5.0"');
  out('    "Use the default Docker Hub image"');
  out("");

  // Option B: Local pack
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("  Option B:  Local MI distribution ZIP");
  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("");
  out("  Uses a wso2mi-<version>.zip file you provide.");
  out("  Useful for custom builds or enterprise packs.");
  out("");

  // Detect local ZIPs
  const zips = await detectLocalZips(dir);
  if (zips.length > 0) {
    out("  Detected local ZIPs:");
    for (const z of zips) {
      out(`    ✓ wso2mi-${z.version}.zip  (${z.path})`);
    }
    out("");
    out("  To choose this option, reply with something like:");
    if (zips.length === 1) {
      out(`    "Use local MI pack"  (will use ${zips[0].version})`);
    } else {
      out(`    "Use local MI pack version ${zips[0].version}"`);
    }
  } else {
    out("  No local ZIPs detected yet. To use this option:");
    out(`    1. Place wso2mi-<version>.zip in: ${getProjectRoot()}`);
    out('    2. Then reply: "Use local MI pack"');
  }
  out("");

  out("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out("");
  out("Which option would you like?");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Full setup — runs after user has chosen a source
// ─────────────────────────────────────────────────────────────────────────────
async function runFullSetup(
  dir: string,
  miSource: MiSource,
  args: {
    projectPath?: string;
    skipBuild?: boolean;
    miVersion?: string;
  },
  out: (s: string) => void,
  lines: string[],
): Promise<string> {
  const miDockerfile = sourceToDockerfile(miSource);
  const isLocalPack = miSource === "local";

  out(log.header("🚀  Kafka + WSO2 MI — Automated Setup"));
  out(log.info(`Project directory: ${dir}`));
  out("");

  // ── Resolve MI version ──────────────────────────────────────────────────
  let miVersion = args.miVersion ?? "";

  // For local pack without a version specified, try auto-detection
  if (isLocalPack && !miVersion) {
    const zips = await detectLocalZips(dir);
    if (zips.length === 1) {
      miVersion = zips[0].version;
      out(log.ok(`Auto-detected local MI pack: wso2mi-${miVersion}.zip`));
    } else if (zips.length > 1) {
      out(log.warn("Multiple local MI ZIPs found:"));
      for (const z of zips) {
        out(`    wso2mi-${z.version}.zip  (${z.path})`);
      }
      out("");
      out("Please specify which version to use, e.g.:");
      out(`    "Use local MI pack version ${zips[0].version}"`);
      return lines.join("\n");
    } else {
      out(log.err("No local MI distribution ZIP found."));
      out("");
      out(log.info("Place wso2mi-<version>.zip in one of:"));
      out(`    1. ${getProjectRoot()}`);
      out(`    2. ${path.join(dir, "wso2mi")}`);
      out("");
      out('Then try again, or reply: "Use Docker Hub image" instead.');
      return lines.join("\n");
    }
  }

  // Default version for Docker Hub
  if (!miVersion) miVersion = "4.4.0";

  const config: MiConfig = { miSource, miDockerfile, miVersion };
  out(log.info(`MI source: ${formatConfig(config)}`));
  out("");

  // ── STEP 1: Prerequisites ─────────────────────────────────────────────────
  out(log.step(1, TOTAL_STEPS, "Checking prerequisites..."));
  const prereqs = ["docker"];
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
  out(`    wso2mi/${miDockerfile} (MI image build)`);
  out("    wso2mi/conf/deployment.toml");
  out("    wso2mi/artifacts/apis/KafkaPublisherAPI.xml");
  out("    wso2mi/artifacts/inbound-endpoints/KafkaOrderConsumer.xml");
  out("    wso2mi/artifacts/sequences/kafkaOrderProcessingSequence.xml");
  out("    wso2mi/artifacts/sequences/kafkaFaultSequence.xml");
  out("");

  // ── Persist config to .env so start_stack and compose commands pick it up ─
  await writeConfig(dir, config);
  out(log.ok(`Saved MI config to ${dir}/.env`));
  out("");

  // ── STEP 3: Pull base images ──────────────────────────────────────────────
  out(log.step(3, TOTAL_STEPS, "Pulling Docker base images..."));
  out(log.wait("Pulling base images..."));
  const imagesToPull = [
    "confluentinc/cp-zookeeper:7.6.1",
    "confluentinc/cp-kafka:7.6.1",
  ];
  if (isLocalPack) {
    imagesToPull.unshift("eclipse-temurin:17-jre-jammy");
  } else {
    imagesToPull.unshift(`wso2/wso2mi:${miVersion}`);
  }
  for (const img of imagesToPull) {
    const r = await docker.pullImage(img);
    if (r.ok) out(log.ok(`Pulled ${img}`));
    else out(log.warn(`Pull may have failed for ${img} (might already be cached)`));
  }
  out("");

  // ── STEP 4: Build WSO2 MI image ────────────────────────────────────────────
  out(log.step(4, TOTAL_STEPS, "Building WSO2 MI image with Kafka connector..."));
  if (isLocalPack) {
    out(log.info(`Using local MI pack with version ${miVersion}`));
    const zipPath = path.join(dir, "wso2mi", `wso2mi-${miVersion}.zip`);
    const zipExists = await import("fs-extra").then(f => f.pathExists(zipPath));
    if (!zipExists) {
      out(log.err(`Local MI pack not found: ${zipPath}`));
      out(log.info(`Place wso2mi-${miVersion}.zip in ${path.join(dir, "wso2mi")} and try again.`));
      out(log.info('Or reply: "Use Docker Hub image" to switch.'));
      return lines.join("\n");
    }
    out(log.ok(`Found ${zipPath}`));
  } else {
    out(log.info(`Using Docker Hub image wso2/wso2mi:${miVersion}`));
  }
  out(log.wait("This downloads the Kafka connector CAR + inbound endpoint JAR. ~2-4 min on first run."));

  if (!args.skipBuild) {
    const buildEnv: Record<string, string> = {
      MI_DOCKERFILE: miDockerfile,
      MI_VERSION: miVersion,
    };
    const buildR = await docker.run(
      "docker",
      ["compose", "build", "--progress=plain", "wso2mi"],
      dir,
      600_000,
      buildEnv
    );
    if (!buildR.ok) {
      out(log.err("WSO2 MI image build failed."));
      out("Build output:");
      out(buildR.stderr.slice(-2000));
      return lines.join("\n");
    }
    out(log.ok("WSO2 MI image built successfully"));
  } else {
    out(log.info("Skipping build (skipBuild=true)"));
  }
  out("");

  // ── STEP 5: Start containers ──────────────────────────────────────────────
  out(log.step(5, TOTAL_STEPS, "Starting all containers..."));
  const composeEnv: Record<string, string> = { MI_DOCKERFILE: miDockerfile, MI_VERSION: miVersion };
  const upR = await docker.composeUp(dir, "docker-compose.yml", composeEnv);
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
    `🐳  MI Source: ${formatConfig(config)}`,
    "",
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
    "💡  MCP tools: run_demo · trigger_error · check_dlq · run_health_checks · show_logs · get_mi_config",
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("http://localhost:8290/kafka/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "smoke-001",
        customer: "SetupSmoke",
        event: "order-created",
        amount: 1.0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok && text.includes("published")) {
      return { ok: true, response: text };
    }
    return { ok: false, error: text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
