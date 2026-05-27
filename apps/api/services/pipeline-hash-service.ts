import crypto from 'crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeValue(item));
    // Array ordering from upstream payloads is not reliable for hashing.
    return normalized.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, JsonValue> = {};
    for (const key of keys) {
      out[key] = normalizeValue(obj[key]);
    }
    return out;
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function sha256Canonical(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function buildSourceHash(payload: unknown): string {
  return sha256Canonical(payload);
}

export function buildSnapshotHash(payload: unknown): string {
  return sha256Canonical(payload);
}

export function buildDecisionHash(payload: unknown): string {
  return sha256Canonical(payload);
}

export function buildExecutionHash(input: {
  sourceHash: string;
  snapshotHash: string;
  decisionHash: string | null;
  schemaVersion: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${input.sourceHash}:${input.snapshotHash}:${input.decisionHash || 'none'}:${input.schemaVersion}`)
    .digest('hex');
}

