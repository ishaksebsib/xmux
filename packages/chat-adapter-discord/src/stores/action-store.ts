import { randomUUID } from "node:crypto";
import type { DiscordActionEnvelope, DiscordActionStore } from "../types";

/** Creates a process-local action store for oversized Discord button payloads. */
export function createMemoryDiscordActionStore(): DiscordActionStore {
  const entries = new Map<
    string,
    { readonly envelope: DiscordActionEnvelope; readonly expiresAt?: number }
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
      const entry = entries.get(key);
      return entry?.envelope;
    },
    set(key, envelope, options) {
      sweep();
      entries.set(key, {
        envelope,
        ...(options?.ttlMs === undefined ? {} : { expiresAt: Date.now() + options.ttlMs }),
      });
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

export function createDiscordActionStoreKey(): string {
  return randomUUID().replaceAll("-", "");
}
