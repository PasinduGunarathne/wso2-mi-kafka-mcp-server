// src/tools/kafka-admin.ts
// MCP tools: list_kafka_topics, describe_kafka_topic, create_kafka_topic, delete_kafka_topic

import * as kafka from "../services/kafka-service.js";
import * as log from "../utils/logger.js";
import { requireString, optionalPositiveInt, validateTopicName } from "../utils/validation.js";

// ─────────────────────────────────────────────────────────────────────────────
export async function listKafkaTopics(): Promise<string> {
  const lines: string[] = [];
  lines.push(log.header("Kafka Topics"));

  const topics = await kafka.listTopics();

  if (topics.length === 0) {
    lines.push(log.warn("No topics found (excluding internal topics)."));
    lines.push(log.info("Create one: create_kafka_topic { \"name\": \"my.topic\" }"));
    return lines.join("\n");
  }

  lines.push(log.ok(`${topics.length} topic(s) found:`));
  lines.push("");
  for (const t of topics) {
    lines.push(`  • ${t}`);
  }
  lines.push("");
  lines.push(log.info("Describe a topic: describe_kafka_topic { \"topic\": \"<name>\" }"));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function describeKafkaTopic(args: { topic?: string }): Promise<string> {
  const topic = requireString(args.topic, "topic");
  const lines: string[] = [];

  lines.push(log.header(`Topic: ${topic}`));
  const info = await kafka.describeTopic(topic);

  lines.push(`  Name:               ${info.name}`);
  lines.push(`  Partitions:         ${info.partitions}`);
  lines.push(`  Replication Factor: ${info.replicationFactor}`);

  if (Object.keys(info.configs).length > 0) {
    lines.push("");
    lines.push("  Configs:");
    for (const [k, v] of Object.entries(info.configs)) {
      lines.push(`    ${k} = ${v}`);
    }
  }

  if (info.partitionDetails.length > 0) {
    lines.push("");
    lines.push("  Partitions:");
    lines.push("    ID  | Leader | Replicas | ISR");
    lines.push("    ----|--------|----------|----");
    for (const p of info.partitionDetails) {
      lines.push(
        `    ${String(p.partition).padEnd(4)}| ${String(p.leader).padEnd(7)}| ${p.replicas.join(",").padEnd(9)}| ${p.isr.join(",")}`
      );
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function createKafkaTopic(args: {
  name?: string;
  partitions?: number;
  replicationFactor?: number;
  configs?: Record<string, string>;
}): Promise<string> {
  const name = validateTopicName(args.name ?? "");
  const partitions = optionalPositiveInt(args.partitions, "partitions", 3);
  const replicationFactor = optionalPositiveInt(args.replicationFactor, "replicationFactor", 1);

  const lines: string[] = [];
  lines.push(log.run(`Creating topic '${name}' (${partitions} partitions, RF=${replicationFactor})...`));

  await kafka.createTopic({ name, partitions, replicationFactor, configs: args.configs });

  lines.push(log.ok(`Topic '${name}' created successfully.`));
  lines.push(log.info(`Describe: describe_kafka_topic { "topic": "${name}" }`));

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function deleteKafkaTopic(args: {
  topic?: string;
  confirm?: boolean;
}): Promise<string> {
  const topic = validateTopicName(args.topic ?? "");

  if (!args.confirm) {
    return [
      log.warn(`This will permanently delete topic '${topic}' and all its messages.`),
      "",
      `To confirm, call: delete_kafka_topic { "topic": "${topic}", "confirm": true }`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(log.run(`Deleting topic '${topic}'...`));

  await kafka.deleteTopic(topic);
  lines.push(log.ok(`Topic '${topic}' deleted.`));

  return lines.join("\n");
}
