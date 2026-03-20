// src/types.ts
// Domain models used across the MCP server.

// ── Kafka ────────────────────────────────────────────────────────────────────

export interface TopicConfig {
  name: string;
  partitions: number;
  replicationFactor: number;
  configs?: Record<string, string>;
}

export interface TopicInfo {
  name: string;
  partitions: number;
  replicationFactor: number;
  configs: Record<string, string>;
  partitionDetails: Array<{
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
  }>;
}

export interface MessageEnvelope {
  topic: string;
  key?: string;
  value: string;
  headers?: Record<string, string>;
  partition?: number;
  timestamp?: string;
  offset?: number;
}

export interface ConsumeOptions {
  topic: string;
  maxMessages: number;
  timeoutMs: number;
  fromBeginning: boolean;
  groupId?: string;
}

// ── WSO2 MI ──────────────────────────────────────────────────────────────────

export interface ArtifactTemplateInput {
  type: "api" | "sequence" | "inbound-endpoint";
  name: string;
  context?: string;          // API context path
  methods?: string[];        // HTTP methods
  topic?: string;            // Kafka topic
  groupId?: string;          // Consumer group
  bootstrapServers?: string; // Kafka bootstrap
  pollInterval?: number;     // ms
  onError?: string;          // fault sequence name
  description?: string;
}

export interface ArtifactValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface FlowTrace {
  orderId: string;
  steps: FlowTraceStep[];
  outcome: "success" | "error" | "partial" | "not_found";
  durationMs?: number;
}

export interface FlowTraceStep {
  phase: string;
  status: "ok" | "warn" | "error" | "skipped";
  detail: string;
  timestamp?: string;
}

export interface StackDiagnostics {
  containers: Array<{ name: string; status: string; healthy: boolean }>;
  topics: string[];
  miApis: string[];
  recentErrors: string[];
  diskUsage?: string;
}
