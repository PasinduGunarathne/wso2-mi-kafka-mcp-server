// src/services/kafka-service.ts
// Kafka CLI wrappers — runs kafka-* commands inside the demo-kafka container.

import { CONTAINERS, exec, run } from "../utils/docker.js";
import type { TopicConfig, TopicInfo, MessageEnvelope, ConsumeOptions } from "../types.js";

const KAFKA = CONTAINERS.KAFKA;
const BS = "localhost:9092"; // bootstrap inside the container

// ── Topic operations ────────────────────────────────────────────────────────

/** List all non-internal Kafka topics. */
export async function listTopics(): Promise<string[]> {
  const r = await exec(KAFKA, [
    "kafka-topics", "--bootstrap-server", BS, "--list",
  ]);
  if (!r.ok) throw new Error(`Failed to list topics: ${r.stderr}`);
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("__"));
}

/** Describe a single topic with partition details. */
export async function describeTopic(topic: string): Promise<TopicInfo> {
  const r = await exec(KAFKA, [
    "kafka-topics", "--bootstrap-server", BS,
    "--describe", "--topic", topic,
  ]);
  if (!r.ok) throw new Error(`Topic '${topic}' not found or Kafka unreachable: ${r.stderr}`);

  const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
  // First line: Topic: <name>  PartitionCount: N  ReplicationFactor: N  Configs: k=v,...
  const headerLine = lines[0] ?? "";
  const partitionCount = parseInt(headerLine.match(/PartitionCount:\s*(\d+)/)?.[1] ?? "0", 10);
  const replicationFactor = parseInt(headerLine.match(/ReplicationFactor:\s*(\d+)/)?.[1] ?? "0", 10);

  const configStr = headerLine.match(/Configs:\s*(.*)/)?.[1] ?? "";
  const configs: Record<string, string> = {};
  if (configStr.trim()) {
    for (const pair of configStr.split(",")) {
      const [k, v] = pair.split("=");
      if (k && v) configs[k.trim()] = v.trim();
    }
  }

  const partitionDetails: TopicInfo["partitionDetails"] = [];
  for (const line of lines.slice(1)) {
    const pMatch = line.match(/Partition:\s*(\d+)/);
    const lMatch = line.match(/Leader:\s*(\d+)/);
    const rMatch = line.match(/Replicas:\s*([\d,]+)/);
    const iMatch = line.match(/Isr:\s*([\d,]+)/);
    if (pMatch) {
      partitionDetails.push({
        partition: parseInt(pMatch[1], 10),
        leader: parseInt(lMatch?.[1] ?? "0", 10),
        replicas: (rMatch?.[1] ?? "").split(",").map(Number),
        isr: (iMatch?.[1] ?? "").split(",").map(Number),
      });
    }
  }

  return { name: topic, partitions: partitionCount, replicationFactor, configs, partitionDetails };
}

/** Create a new Kafka topic. */
export async function createTopic(config: TopicConfig): Promise<void> {
  const args = [
    "kafka-topics", "--bootstrap-server", BS,
    "--create",
    "--topic", config.name,
    "--partitions", String(config.partitions),
    "--replication-factor", String(config.replicationFactor),
  ];
  if (config.configs) {
    for (const [k, v] of Object.entries(config.configs)) {
      args.push("--config", `${k}=${v}`);
    }
  }
  const r = await exec(KAFKA, args);
  if (!r.ok) throw new Error(`Failed to create topic '${config.name}': ${r.stderr}`);
}

/** Delete a Kafka topic. */
export async function deleteTopic(topic: string): Promise<void> {
  const r = await exec(KAFKA, [
    "kafka-topics", "--bootstrap-server", BS,
    "--delete", "--topic", topic,
  ]);
  if (!r.ok) throw new Error(`Failed to delete topic '${topic}': ${r.stderr}`);
}

// ── Message operations ──────────────────────────────────────────────────────

/** Publish a message to a Kafka topic. */
export async function publishMessage(msg: MessageEnvelope): Promise<void> {
  const { execa: execaFn } = await import("execa");

  const producerArgs = [
    "kafka-console-producer",
    "--bootstrap-server", BS,
    "--topic", msg.topic,
  ];
  if (msg.key) {
    producerArgs.push("--property", "parse.key=true", "--property", "key.separator=|");
  }

  const payload = msg.key ? `${msg.key}|${msg.value}` : msg.value;

  // Use docker exec with stdin piping — no shell required, works on all OS
  const r = await execaFn(
    "docker",
    ["exec", "-i", KAFKA, ...producerArgs],
    {
      input: payload + "\n",
      reject: false,
      timeout: 30_000,
    }
  );
  if (r.exitCode !== 0) throw new Error(`Failed to publish to '${msg.topic}': ${r.stderr}`);
}

/** Consume messages from a Kafka topic. */
export async function consumeMessages(opts: ConsumeOptions): Promise<MessageEnvelope[]> {
  const args = [
    "kafka-console-consumer",
    "--bootstrap-server", BS,
    "--topic", opts.topic,
    "--max-messages", String(opts.maxMessages),
    "--timeout-ms", String(opts.timeoutMs),
  ];
  if (opts.fromBeginning) args.push("--from-beginning");
  if (opts.groupId) args.push("--group", opts.groupId);

  // Include timestamp and partition info
  args.push(
    "--property", "print.timestamp=true",
    "--property", "print.partition=true",
    "--property", "print.offset=true",
  );

  const r = await exec(KAFKA, args, Math.max(opts.timeoutMs + 5000, 30_000));

  const messages: MessageEnvelope[] = [];
  if (!r.stdout.trim()) return messages;

  for (const line of r.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Processed")) continue;

    // Format: CreateTime:<ts>\tPartition:<p>\tOffset:<o>\t<value>
    const tsMatch = trimmed.match(/CreateTime:(\d+)/);
    const partMatch = trimmed.match(/Partition:(\d+)/);
    const offMatch = trimmed.match(/Offset:(\d+)/);

    // Extract value — everything after the last known property
    let value = trimmed;
    const lastProp = trimmed.lastIndexOf("\t");
    if (lastProp >= 0 && (tsMatch || partMatch || offMatch)) {
      value = trimmed.substring(lastProp + 1);
    }

    messages.push({
      topic: opts.topic,
      value,
      partition: partMatch ? parseInt(partMatch[1], 10) : undefined,
      offset: offMatch ? parseInt(offMatch[1], 10) : undefined,
      timestamp: tsMatch ? tsMatch[1] : undefined,
    });
  }

  return messages;
}

/** Search messages in a topic by substring match. */
export async function searchMessages(
  topic: string,
  query: string,
  maxMessages: number
): Promise<MessageEnvelope[]> {
  // Consume all available messages and filter client-side
  const all = await consumeMessages({
    topic,
    maxMessages: 500,  // read up to 500 to search through
    timeoutMs: 10_000,
    fromBeginning: true,
  });

  const lowerQuery = query.toLowerCase();
  return all
    .filter((m) => m.value.toLowerCase().includes(lowerQuery))
    .slice(0, maxMessages);
}

/** Replay DLQ messages back to an input topic. */
export async function replayDLQ(
  dlqTopic: string,
  targetTopic: string,
  maxMessages: number
): Promise<{ replayed: number; errors: string[] }> {
  const messages = await consumeMessages({
    topic: dlqTopic,
    maxMessages,
    timeoutMs: 10_000,
    fromBeginning: true,
    groupId: `replay-${Date.now()}`,
  });

  let replayed = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    // Extract original payload if the DLQ message has our envelope format
    let payload = msg.value;
    try {
      const parsed = JSON.parse(msg.value);
      if (parsed.originalPayload) {
        payload = typeof parsed.originalPayload === "string"
          ? parsed.originalPayload
          : JSON.stringify(parsed.originalPayload);
      }
    } catch {
      // Use raw value
    }

    try {
      await publishMessage({ topic: targetTopic, value: payload });
      replayed++;
    } catch (e: any) {
      errors.push(`Failed to replay message: ${e.message}`);
    }
  }

  return { replayed, errors };
}
