// src/services/mi-service.ts
// WSO2 MI management API wrappers and artifact generation.

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { run, exec, CONTAINERS, composeLogs } from "../utils/docker.js";
import type { ArtifactTemplateInput, ArtifactValidationResult } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../resources/templates");

// ── Management API ──────────────────────────────────────────────────────────

/** List deployed APIs via the MI management API. */
export async function listDeployedApis(): Promise<string[]> {
  const r = await run("curl", ["-sf", "http://localhost:9164/management/apis"], undefined, 10_000);
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout);
    // MI returns { count: N, list: [{ name, ... }] }
    if (Array.isArray(data.list)) return data.list.map((a: any) => a.name);
    if (Array.isArray(data)) return data.map((a: any) => a.name);
    return [];
  } catch {
    return [];
  }
}

/** List deployed inbound endpoints via MI management API. */
export async function listInboundEndpoints(): Promise<string[]> {
  const r = await run("curl", ["-sf", "http://localhost:9164/management/inbound-endpoints"], undefined, 10_000);
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout);
    if (Array.isArray(data.list)) return data.list.map((a: any) => a.name);
    if (Array.isArray(data)) return data.map((a: any) => a.name);
    return [];
  } catch {
    return [];
  }
}

/** List deployed sequences via MI management API. */
export async function listSequences(): Promise<string[]> {
  const r = await run("curl", ["-sf", "http://localhost:9164/management/sequences"], undefined, 10_000);
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.stdout);
    if (Array.isArray(data.list)) return data.list.map((a: any) => a.name);
    if (Array.isArray(data)) return data.map((a: any) => a.name);
    return [];
  } catch {
    return [];
  }
}

/** Get recent MI error logs. */
export async function getRecentErrors(tail = 100): Promise<string[]> {
  const r = await composeLogs(undefined, "wso2mi", tail);
  return r.stdout
    .split("\n")
    .filter((l) => /ERROR|WARN|Exception|FAULT/i.test(l))
    .slice(-30);
}

// ── Artifact generation ─────────────────────────────────────────────────────

function loadTemplate(filename: string): string {
  const fp = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(fp)) throw new Error(`Template not found: ${fp}`);
  return fs.readFileSync(fp, "utf-8");
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/** Generate a WSO2 MI API artifact from template. */
export function generateApi(input: ArtifactTemplateInput): { xml: string; filename: string } {
  const template = loadTemplate("api.xml.mustache");
  const xml = renderTemplate(template, {
    NAME: input.name,
    CONTEXT: input.context ?? `/${input.name.toLowerCase()}`,
    METHODS: (input.methods ?? ["POST", "GET"]).join(" "),
    DESCRIPTION: input.description ?? `Auto-generated API: ${input.name}`,
  });
  return { xml, filename: `${input.name}.xml` };
}

/** Generate a WSO2 MI sequence artifact from template. */
export function generateSequence(input: ArtifactTemplateInput): { xml: string; filename: string } {
  const template = loadTemplate("sequence.xml.mustache");
  const xml = renderTemplate(template, {
    NAME: input.name,
    ON_ERROR: input.onError ?? "kafkaFaultSequence",
    DESCRIPTION: input.description ?? `Auto-generated sequence: ${input.name}`,
  });
  return { xml, filename: `${input.name}.xml` };
}

/** Generate a Kafka inbound endpoint artifact from template. */
export function generateInboundEndpoint(input: ArtifactTemplateInput): { xml: string; filename: string } {
  const template = loadTemplate("inbound-endpoint.xml.mustache");
  const xml = renderTemplate(template, {
    NAME: input.name,
    TOPIC: input.topic ?? "demo.orders.in",
    GROUP_ID: input.groupId ?? `wso2-mi-${input.name.toLowerCase()}`,
    BOOTSTRAP_SERVERS: input.bootstrapServers ?? "kafka:29092",
    POLL_INTERVAL: String(input.pollInterval ?? 1000),
    SEQUENCE: `${input.name}ProcessingSequence`,
    ON_ERROR: input.onError ?? "kafkaFaultSequence",
    DESCRIPTION: input.description ?? `Kafka consumer: ${input.name}`,
  });
  return { xml, filename: `${input.name}.xml` };
}

// ── Artifact validation ─────────────────────────────────────────────────────

/** Validate a Synapse XML artifact for common issues. */
export function validateArtifactXml(filePath: string, content: string): ArtifactValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic XML well-formedness check
  if (!content.includes("<?xml")) {
    errors.push("Missing XML declaration (<?xml version=\"1.0\" ...?>).");
  }

  // Check for Synapse namespace
  if (!content.includes("http://ws.apache.org/ns/synapse")) {
    errors.push("Missing Synapse namespace: xmlns=\"http://ws.apache.org/ns/synapse\".");
  }

  // API-specific checks
  if (content.includes("<api ")) {
    if (!content.includes("context=")) {
      errors.push("API element missing 'context' attribute.");
    }
    if (!content.includes("name=")) {
      errors.push("API element missing 'name' attribute.");
    }
    if (!content.includes("<inSequence>")) {
      warnings.push("API resource has no <inSequence> — requests will pass through unprocessed.");
    }
    if (!content.includes("<faultSequence")) {
      warnings.push("No <faultSequence> defined — errors will use default handling.");
    }
  }

  // Sequence-specific checks
  if (content.includes("<sequence ")) {
    if (!content.includes("name=")) {
      errors.push("Sequence element missing 'name' attribute.");
    }
  }

  // Inbound endpoint checks
  if (content.includes("<inboundEndpoint")) {
    if (!content.includes("name=")) {
      errors.push("InboundEndpoint missing 'name' attribute.");
    }
    if (!content.includes("sequence=")) {
      errors.push("InboundEndpoint missing 'sequence' attribute (dispatch target).");
    }
    if (content.includes("KafkaMessageConsumer")) {
      if (!content.includes("bootstrap.servers")) {
        errors.push("Kafka inbound endpoint missing 'bootstrap.servers' parameter.");
      }
      if (!content.includes("topic.name")) {
        errors.push("Kafka inbound endpoint missing 'topic.name' parameter.");
      }
      if (!content.includes("group.id")) {
        warnings.push("Kafka inbound endpoint missing 'group.id' — Kafka will auto-assign one.");
      }
    }
  }

  // Kafka connector usage checks
  if (content.includes("kafkaTransport.publishMessages")) {
    if (!content.includes("configKey=")) {
      errors.push("kafkaTransport.publishMessages missing 'configKey' (connection reference).");
    }
    if (!content.includes("<topic>")) {
      errors.push("kafkaTransport.publishMessages missing <topic> element.");
    }
  }

  // Common mistakes
  if (content.includes("localhost:9092") && content.includes("<inboundEndpoint")) {
    warnings.push(
      "Using 'localhost:9092' in an inbound endpoint — inside Docker, use 'kafka:29092' instead."
    );
  }

  return {
    file: filePath,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
