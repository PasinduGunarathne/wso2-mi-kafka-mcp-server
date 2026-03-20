// src/tools/kafka-messages.ts
// MCP tools: publish_message, consume_messages, replay_dlq_to_input, search_messages

import * as kafka from "../services/kafka-service.js";
import * as log from "../utils/logger.js";
import {
  requireString,
  optionalPositiveInt,
  optionalBool,
  validateTopicName,
} from "../utils/validation.js";

// ─────────────────────────────────────────────────────────────────────────────
export async function publishMessage(args: {
  topic?: string;
  value?: string;
  key?: string;
}): Promise<string> {
  const topic = validateTopicName(args.topic ?? "");
  const value = requireString(args.value, "value");

  const lines: string[] = [];
  lines.push(log.run(`Publishing to '${topic}'...`));

  await kafka.publishMessage({ topic, value, key: args.key });

  lines.push(log.ok("Message published."));
  lines.push(`  Topic: ${topic}`);
  if (args.key) lines.push(`  Key:   ${args.key}`);
  lines.push(`  Value: ${value.length > 200 ? value.slice(0, 200) + "..." : value}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function consumeMessages(args: {
  topic?: string;
  maxMessages?: number;
  timeoutMs?: number;
  fromBeginning?: boolean;
  groupId?: string;
}): Promise<string> {
  const topic = validateTopicName(args.topic ?? "");
  const maxMessages = optionalPositiveInt(args.maxMessages, "maxMessages", 10);
  const timeoutMs = optionalPositiveInt(args.timeoutMs, "timeoutMs", 10_000);
  const fromBeginning = optionalBool(args.fromBeginning, true);

  const lines: string[] = [];
  lines.push(log.run(`Consuming up to ${maxMessages} messages from '${topic}'...`));

  const messages = await kafka.consumeMessages({
    topic,
    maxMessages,
    timeoutMs,
    fromBeginning,
    groupId: args.groupId,
  });

  if (messages.length === 0) {
    lines.push(log.warn(`No messages found in '${topic}'.`));
    return lines.join("\n");
  }

  lines.push(log.ok(`${messages.length} message(s) consumed from '${topic}':`));
  lines.push("");

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    lines.push(`── Message ${i + 1} ──`);
    if (m.partition !== undefined) lines.push(`  Partition: ${m.partition}`);
    if (m.offset !== undefined) lines.push(`  Offset:    ${m.offset}`);
    if (m.timestamp) lines.push(`  Timestamp: ${m.timestamp}`);
    lines.push(`  Value:     ${m.value}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function replayDLQToInput(args: {
  dlqTopic?: string;
  targetTopic?: string;
  maxMessages?: number;
  confirm?: boolean;
}): Promise<string> {
  const dlqTopic = validateTopicName(args.dlqTopic ?? "demo.orders.dlq");
  const targetTopic = validateTopicName(args.targetTopic ?? "demo.orders.in");
  const maxMessages = optionalPositiveInt(args.maxMessages, "maxMessages", 10);

  if (!args.confirm) {
    return [
      log.warn(`This will replay up to ${maxMessages} messages from '${dlqTopic}' → '${targetTopic}'.`),
      "",
      `To proceed: replay_dlq_to_input { "confirm": true }`,
      `  Optional: "dlqTopic", "targetTopic", "maxMessages"`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(log.run(`Replaying from '${dlqTopic}' → '${targetTopic}'...`));

  const result = await kafka.replayDLQ(dlqTopic, targetTopic, maxMessages);

  lines.push(log.ok(`Replayed ${result.replayed} message(s).`));
  if (result.errors.length > 0) {
    lines.push(log.warn(`${result.errors.length} error(s) during replay:`));
    result.errors.forEach((e) => lines.push(`  • ${e}`));
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
export async function searchMessages(args: {
  topic?: string;
  query?: string;
  maxResults?: number;
}): Promise<string> {
  const topic = validateTopicName(args.topic ?? "");
  const query = requireString(args.query, "query");
  const maxResults = optionalPositiveInt(args.maxResults, "maxResults", 20);

  const lines: string[] = [];
  lines.push(log.run(`Searching '${topic}' for "${query}"...`));

  const matches = await kafka.searchMessages(topic, query, maxResults);

  if (matches.length === 0) {
    lines.push(log.warn(`No messages matching "${query}" in '${topic}'.`));
    return lines.join("\n");
  }

  lines.push(log.ok(`${matches.length} match(es) found:`));
  lines.push("");

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    lines.push(`── Match ${i + 1} ──`);
    if (m.partition !== undefined) lines.push(`  Partition: ${m.partition}`);
    if (m.offset !== undefined) lines.push(`  Offset:    ${m.offset}`);
    lines.push(`  Value:     ${m.value}`);
    lines.push("");
  }

  return lines.join("\n");
}
