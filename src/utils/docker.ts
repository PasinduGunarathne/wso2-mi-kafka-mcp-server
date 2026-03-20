// src/utils/docker.ts
// Wrappers around docker / docker compose CLI calls

import os from "os";
import path from "path";
import { execa, ExecaError } from "execa";
import * as log from "./logger.js";

// ── Container name constants ─────────────────────────────────────────────────
export const CONTAINERS = {
  ZOOKEEPER: "demo-zookeeper",
  KAFKA: "demo-kafka",
  KAFKA_UI: "demo-kafka-ui",
  WSO2MI: "demo-wso2mi",
} as const;

/** Extra bin directories to prepend to PATH for container runtimes. */
const EXTRA_PATHS = [
  path.join(os.homedir(), ".rd", "bin"),   // Rancher Desktop (symlinked)
  "/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin", // Rancher Desktop (macOS direct)
];

function extendedPath(): string {
  const current = process.env.PATH ?? "";
  const dirs = EXTRA_PATHS.filter((d) => !current.split(path.delimiter).includes(d));
  return dirs.length > 0 ? dirs.join(path.delimiter) + path.delimiter + current : current;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  ok: boolean;
}

/** Run an arbitrary shell command, capture output. */
export async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs?: number
): Promise<RunResult> {
  try {
    const result = await execa(cmd, args, {
      cwd: cwd || undefined,
      reject: false,
      all: true,
      env: { PATH: extendedPath() },
      timeout: timeoutMs,
    });
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      ok: result.exitCode === 0,
    };
  } catch (e) {
    const ex = e as ExecaError;
    return { stdout: String(ex.stdout ?? ""), stderr: String(ex.stderr ?? ex.message), ok: false };
  }
}

/** Check if a binary is available on PATH. */
export async function which(bin: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = await run(cmd, [bin], undefined, 5_000);
  return r.ok;
}

/** docker compose up -d with build. */
export async function composeUp(projectDir: string, file = "docker-compose.yml"): Promise<RunResult> {
  return run("docker", ["compose", "-f", file, "up", "-d", "--build", "--remove-orphans"], projectDir, 600_000);
}

/** docker compose down -v. */
export async function composeDown(projectDir: string, file = "docker-compose.yml"): Promise<RunResult> {
  return run("docker", ["compose", "-f", file, "down", "-v", "--remove-orphans"], projectDir, 120_000);
}

/** docker compose stop. */
export async function composeStop(projectDir: string, file = "docker-compose.yml"): Promise<RunResult> {
  return run("docker", ["compose", "-f", file, "stop"], projectDir, 60_000);
}

/** docker compose ps. */
export async function composePs(projectDir: string, file = "docker-compose.yml"): Promise<RunResult> {
  return run("docker", ["compose", "-f", file, "ps", "--format", "json"], projectDir, 15_000);
}

/** docker compose logs [service]. Uses `docker logs` when no projectDir. */
export async function composeLogs(
  projectDir?: string,
  service?: string,
  tail = 50
): Promise<RunResult> {
  if (!projectDir && service) {
    // No compose file context — use docker logs directly on the container
    const containerName = `demo-${service}`;
    return run("docker", ["logs", "--tail", String(tail), containerName], undefined, 30_000);
  }
  const args = ["compose", "logs", "--tail", String(tail)];
  if (service) args.push(service);
  return run("docker", args, projectDir, 30_000);
}

/** Pull an image explicitly. */
export async function pullImage(image: string): Promise<RunResult> {
  return run("docker", ["pull", image], undefined, 300_000);
}

/**
 * Poll until a docker exec check succeeds or timeout.
 * checkCmd is run inside the container.
 */
export async function waitUntilHealthy(
  container: string,
  checkCmd: string[],
  timeoutMs = 120_000,
  intervalMs = 3_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await run("docker", ["exec", container, ...checkCmd]);
    if (r.ok) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Check container health status via `docker inspect`. */
export async function containerHealthy(container: string): Promise<boolean> {
  const r = await run("docker", [
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    container,
  ]);
  return r.stdout.trim() === "healthy";
}

/** Execute a command inside a running container. */
export async function exec(
  container: string,
  cmd: string[],
  timeoutMs = 30_000
): Promise<RunResult> {
  return run("docker", ["exec", container, ...cmd], undefined, timeoutMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
