import { randomUUID } from "node:crypto";
import type { SlackActionEnvelope, SlackActionStore } from "../types";

const defaultMemoryActionStoreTtlMs = 24 * 60 * 60 * 1_000;

/** Creates a process-local action store for oversized Slack button payloads. */
export function createMemorySlackActionStore(
  options: {
    readonly defaultTtlMs?: number;
  } = {},
): SlackActionStore {
  const defaultTtlMs = options.defaultTtlMs ?? defaultMemoryActionStoreTtlMs;
  const entries = new Map<
    string,
    { readonly envelope: SlackActionEnvelope; readonly expiresAt?: number }
  >();

  function sweep(now = Date.now()) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        entries.delete(key);
      }
    }
  }

  return {
    get(key) {
      sweep();
      return entries.get(key)?.envelope;
    },
    set(key, envelope, options) {
      sweep();
      const ttlMs = options?.ttlMs ?? defaultTtlMs;
      entries.set(key, {
        envelope,
        ...(ttlMs === undefined ? {} : { expiresAt: Date.now() + ttlMs }),
      });
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

export function createSlackActionStoreKey(): string {
  return randomUUID().replaceAll("-", "");
}
