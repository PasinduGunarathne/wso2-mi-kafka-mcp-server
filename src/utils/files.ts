// src/utils/files.ts
// Generates the complete kafka-mi-demo project on disk
// by copying resource files from the resources/ directory.

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { execa } from "execa";

export const PROJECT_NAME = "kafka-mi-demo";

// Resolve the project root (two levels up from src/utils/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const RESOURCES_DIR = path.join(PROJECT_ROOT, "resources");

/** Returns the absolute path to the demo project directory. */
export function projectDir(base?: string): string {
  return base
    ? path.resolve(base)
    : path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", PROJECT_NAME);
}

/** Read a resource file from the resources/ directory. */
function resource(...segments: string[]): string {
  return fs.readFileSync(path.join(RESOURCES_DIR, ...segments), "utf8");
}

/** Write a text file, creating parent dirs as needed. */
async function write(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point — write all files to disk
// ─────────────────────────────────────────────────────────────────────────────
export async function generateProjectFiles(baseDir: string): Promise<string[]> {
  const created: string[] = [];

  const w = async (rel: string, content: string) => {
    const abs = path.join(baseDir, rel);
    await write(abs, content);
    created.push(abs);
  };

  // Docker Compose
  await w("docker-compose.yml", resource("docker", "docker-compose.yml"));

  // WSO2 MI Dockerfiles and config
  await w("wso2mi/Dockerfile",              resource("docker", "Dockerfile"));
  await w("wso2mi/Dockerfile.dockerhub",    resource("docker", "Dockerfile.dockerhub"));
  await w("wso2mi/conf/deployment.toml",    resource("conf", "deployment.toml"));

  // Copy the local MI distribution zip into the Docker build context (if it exists)
  const miZipSrc = path.join(PROJECT_ROOT, "wso2mi-4.4.0.zip");
  const miZipDest = path.join(baseDir, "wso2mi", "wso2mi-4.4.0.zip");
  if (await fs.pathExists(miZipSrc)) {
    await fs.copy(miZipSrc, miZipDest);
    created.push(miZipDest);
  }

  // WSO2 MI artifacts
  await w("wso2mi/artifacts/local-entries/KafkaProducerConn.xml",
    resource("artifacts", "local-entries", "KafkaProducerConn.xml"));
  await w("wso2mi/artifacts/apis/KafkaPublisherAPI.xml",
    resource("artifacts", "apis", "KafkaPublisherAPI.xml"));
  await w("wso2mi/artifacts/inbound-endpoints/KafkaOrderConsumer.xml",
    resource("artifacts", "inbound-endpoints", "KafkaOrderConsumer.xml"));
  await w("wso2mi/artifacts/sequences/kafkaOrderProcessingSequence.xml",
    resource("artifacts", "sequences", "kafkaOrderProcessingSequence.xml"));
  await w("wso2mi/artifacts/sequences/kafkaFaultSequence.xml",
    resource("artifacts", "sequences", "kafkaFaultSequence.xml"));
  await w("wso2mi/artifacts/imports/{org.wso2.carbon.connector}kafkaTransport_3.2.0.xml",
    resource("artifacts", "imports", "{org.wso2.carbon.connector}kafkaTransport_3.2.0.xml"));

  // Scripts
  await w("scripts/create-topics.sh",  resource("scripts", "create-topics.sh"));
  await w("scripts/test-publish.sh",   resource("scripts", "test-publish.sh"));
  await w("scripts/test-consume.sh",   resource("scripts", "test-consume.sh"));
  await w("scripts/verify-stack.sh",   resource("scripts", "verify-stack.sh"));
  await w("scripts/bootstrap.sh",      resource("scripts", "bootstrap.sh"));

  // Make scripts executable (Unix)
  try {
    for (const script of ["bootstrap.sh", "create-topics.sh", "test-publish.sh", "test-consume.sh", "verify-stack.sh"]) {
      await execa("chmod", ["+x", path.join(baseDir, "scripts", script)]);
    }
  } catch { /* Windows — skip chmod */ }

  return created;
}
