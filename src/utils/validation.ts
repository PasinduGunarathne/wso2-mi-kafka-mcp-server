// src/utils/validation.ts
// Input validation helpers for MCP tool arguments.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Ensure a required string field is present and non-empty. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`'${field}' is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** Parse an optional positive integer, falling back to a default. */
export function optionalPositiveInt(value: unknown, field: string, defaultVal: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new ValidationError(`'${field}' must be a positive integer.`);
  }
  return n;
}

/** Parse an optional positive number (not necessarily integer). */
export function optionalPositiveNumber(value: unknown, field: string, defaultVal: number): number {
  if (value === undefined || value === null) return defaultVal;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`'${field}' must be a positive number.`);
  }
  return n;
}

/** Parse an optional boolean, falling back to a default. */
export function optionalBool(value: unknown, defaultVal: boolean): boolean {
  if (value === undefined || value === null) return defaultVal;
  return Boolean(value);
}

/** Validate a Kafka topic name (basic sanity). */
export function validateTopicName(name: string): string {
  const trimmed = requireString(name, "topic");
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new ValidationError(
      `Invalid topic name '${trimmed}'. Use only letters, digits, '.', '_', or '-'.`
    );
  }
  if (trimmed.length > 249) {
    throw new ValidationError("Topic name must be 249 characters or fewer.");
  }
  return trimmed;
}
