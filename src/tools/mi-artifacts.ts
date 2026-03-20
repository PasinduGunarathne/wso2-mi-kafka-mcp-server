// src/tools/mi-artifacts.ts
// MCP tools: generate_mi_api, generate_mi_sequence, generate_mi_inbound_endpoint, validate_mi_artifacts

import fs from "fs-extra";
import path from "path";
import * as mi from "../services/mi-service.js";
import * as log from "../utils/logger.js";
import { requireString } from "../utils/validation.js";
import type { ArtifactTemplateInput } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
export async function generateMiApi(args: {
  name?: string;
  context?: string;
  methods?: string[];
  description?: string;
  outputDir?: string;
}): Promise<string> {
  const name = requireString(args.name, "name");
  const lines: string[] = [];
  lines.push(log.header(`Generate API: ${name}`));

  const input: ArtifactTemplateInput = {
    type: "api",
    name,
    context: args.context,
    methods: args.methods,
    description: args.description,
  };

  const { xml, filename } = mi.generateApi(input);

  if (args.outputDir) {
    const outPath = path.join(args.outputDir, filename);
    await fs.ensureDir(args.outputDir);
    await fs.writeFile(outPath, xml, "utf-8");
    lines.push(log.ok(`Written to: ${outPath}`));
  }

  lines.push("");
  lines.push("─── Generated XML ─────────────────────────────────────────────");
  lines.push(xml);
  lines.push("");
  lines.push(log.info("To deploy: place in MI's deployment/server/synapse-configs/default/api/ directory."));
  lines.push(log.done("API artifact generated."));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function generateMiSequence(args: {
  name?: string;
  onError?: string;
  description?: string;
  outputDir?: string;
}): Promise<string> {
  const name = requireString(args.name, "name");
  const lines: string[] = [];
  lines.push(log.header(`Generate Sequence: ${name}`));

  const input: ArtifactTemplateInput = {
    type: "sequence",
    name,
    onError: args.onError,
    description: args.description,
  };

  const { xml, filename } = mi.generateSequence(input);

  if (args.outputDir) {
    const outPath = path.join(args.outputDir, filename);
    await fs.ensureDir(args.outputDir);
    await fs.writeFile(outPath, xml, "utf-8");
    lines.push(log.ok(`Written to: ${outPath}`));
  }

  lines.push("");
  lines.push("─── Generated XML ─────────────────────────────────────────────");
  lines.push(xml);
  lines.push("");
  lines.push(log.info("To deploy: place in MI's deployment/server/synapse-configs/default/sequences/ directory."));
  lines.push(log.done("Sequence artifact generated."));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function generateMiInboundEndpoint(args: {
  name?: string;
  topic?: string;
  groupId?: string;
  bootstrapServers?: string;
  pollInterval?: number;
  onError?: string;
  description?: string;
  outputDir?: string;
}): Promise<string> {
  const name = requireString(args.name, "name");
  const lines: string[] = [];
  lines.push(log.header(`Generate Inbound Endpoint: ${name}`));

  const input: ArtifactTemplateInput = {
    type: "inbound-endpoint",
    name,
    topic: args.topic,
    groupId: args.groupId,
    bootstrapServers: args.bootstrapServers,
    pollInterval: args.pollInterval,
    onError: args.onError,
    description: args.description,
  };

  const { xml, filename } = mi.generateInboundEndpoint(input);

  if (args.outputDir) {
    const outPath = path.join(args.outputDir, filename);
    await fs.ensureDir(args.outputDir);
    await fs.writeFile(outPath, xml, "utf-8");
    lines.push(log.ok(`Written to: ${outPath}`));
  }

  lines.push("");
  lines.push("─── Generated XML ─────────────────────────────────────────────");
  lines.push(xml);
  lines.push("");
  lines.push(log.info("To deploy: place in MI's deployment/server/synapse-configs/default/inbound-endpoints/ directory."));
  lines.push(log.info(`Remember to create the companion sequence: ${name}ProcessingSequence`));
  lines.push(log.done("Inbound endpoint artifact generated."));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function validateMiArtifacts(args: {
  directory?: string;
  file?: string;
}): Promise<string> {
  const lines: string[] = [];
  lines.push(log.header("Validate MI Artifacts"));

  const files: string[] = [];

  if (args.file) {
    if (!await fs.pathExists(args.file)) {
      return log.err(`File not found: ${args.file}`);
    }
    files.push(args.file);
  } else if (args.directory) {
    if (!await fs.pathExists(args.directory)) {
      return log.err(`Directory not found: ${args.directory}`);
    }
    const entries = await fs.readdir(args.directory);
    for (const e of entries) {
      if (e.endsWith(".xml")) files.push(path.join(args.directory, e));
    }
  } else {
    // Default: validate the project's resource artifacts
    const artifactsDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../resources/artifacts"
    );
    for (const subdir of ["apis", "sequences", "inbound-endpoints", "local-entries"]) {
      const dir = path.join(artifactsDir, subdir);
      if (await fs.pathExists(dir)) {
        const entries = await fs.readdir(dir);
        for (const e of entries) {
          if (e.endsWith(".xml")) files.push(path.join(dir, e));
        }
      }
    }
  }

  if (files.length === 0) {
    lines.push(log.warn("No XML files found to validate."));
    return lines.join("\n");
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const f of files) {
    const content = await fs.readFile(f, "utf-8");
    const result = mi.validateArtifactXml(f, content);

    const basename = path.basename(f);
    if (result.valid && result.warnings.length === 0) {
      lines.push(log.ok(basename));
    } else if (result.valid) {
      lines.push(log.warn(`${basename} (${result.warnings.length} warning(s))`));
      result.warnings.forEach((w) => lines.push(`    ⚠ ${w}`));
    } else {
      lines.push(log.err(`${basename} (${result.errors.length} error(s), ${result.warnings.length} warning(s))`));
      result.errors.forEach((e) => lines.push(`    ✗ ${e}`));
      result.warnings.forEach((w) => lines.push(`    ⚠ ${w}`));
    }

    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  lines.push("");
  lines.push(`─── Summary: ${files.length} file(s), ${totalErrors} error(s), ${totalWarnings} warning(s) ───`);

  if (totalErrors === 0) {
    lines.push(log.done("All artifacts are valid."));
  } else {
    lines.push(log.err("Fix the errors above before deploying."));
  }

  return lines.join("\n");
}
