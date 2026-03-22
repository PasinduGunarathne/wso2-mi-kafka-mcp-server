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

/** Extra bin directories to prepend to PATH for container runtimes (cross-platform). */
function extraPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [
    // Rancher Desktop — all platforms create ~/.rd/bin symlinks
    path.join(home, ".rd", "bin"),
  ];

  switch (process.platform) {
    case "darwin":
      paths.push("/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin");
      // Docker Desktop for macOS
      paths.push("/usr/local/bin");
      break;
    case "win32":
      // Rancher Desktop for Windows
      paths.push(path.join(home, "AppData", "Local", "Programs", "Rancher Desktop", "resources", "resources", "win32", "bin"));
      // Docker Desktop for Windows
      paths.push("C:\\Program Files\\Docker\\Docker\\resources\\bin");
      break;
    case "linux":
      // Docker typically available in standard paths
      paths.push("/usr/bin");
      paths.push("/usr/local/bin");
      // Rancher Desktop AppImage on Linux
      paths.push(path.join(home, ".local", "bin"));
      break;
  }

  return paths;
}

function extendedPath(): string {
  const current = process.env.PATH ?? "";
  const dirs = extraPaths().filter((d) => !current.split(path.delimiter).includes(d));
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
  timeoutOrEnv?: number | Record<string, string>,
  extraEnv?: Record<string, string>,
): Promise<RunResult> {
  // Flexible signature: run(cmd, args, cwd, timeoutMs) or run(cmd, args, cwd, envObj) or run(cmd, args, cwd, timeoutMs, envObj)
  let timeoutMs: number | undefined;
  let env: Record<string, string> = {};
  if (typeof timeoutOrEnv === "number") {
    timeoutMs = timeoutOrEnv;
    if (extraEnv) env = extraEnv;
  } else if (timeoutOrEnv && typeof timeoutOrEnv === "object") {
    env = timeoutOrEnv;
  }

  try {
    const result = await execa(cmd, args, {
      cwd: cwd || undefined,
      reject: false,
      all: true,
      env: { PATH: extendedPath(), ...env },
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
export async function composeUp(projectDir: string, file = "docker-compose.yml", env?: Record<string, string>): Promise<RunResult> {
  return run("docker", ["compose", "-f", file, "up", "-d", "--build", "--remove-orphans"], projectDir, 600_000, env);
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

/**
 * HTTP GET with timeout using native fetch (Node 18+).
 * Cross-platform replacement for `curl -sf <url>`.
 */
export async function httpGet(url: string, timeoutMs = 5_000): Promise<RunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { stdout: body, stderr: "", ok: res.ok };
  } catch (e: any) {
    return { stdout: "", stderr: e.message, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP request with timeout using native fetch (Node 18+).
 * Cross-platform replacement for curl.
 */
export async function httpRequest(
  url: string,
  opts: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, body: "", error: e.message };
  } finally {
    clearTimeout(timer);
  }
}
