export interface SlackStreamSourceContext {
  readonly channelId: string;
  readonly messageTs: string;
  readonly threadTs: string;
  readonly recipientUserId?: string;
  readonly recipientTeamId?: string;
}

export interface SlackStreamSourceRegistry {
  put(context: SlackStreamSourceContext): void;
  get(input: {
    readonly channelId: string;
    readonly messageTs: string;
  }): SlackStreamSourceContext | undefined;
}

interface StoredSlackStreamSourceContext {
  readonly context: SlackStreamSourceContext;
  readonly expiresAt: number;
}

const defaultMaxEntries = 5_000;
const defaultTtlMs = 24 * 60 * 60 * 1_000;

export function createSlackStreamSourceRegistry(
  options: { readonly maxEntries?: number; readonly ttlMs?: number } = {},
): SlackStreamSourceRegistry {
  const maxEntries = normalizePositiveInteger(options.maxEntries, defaultMaxEntries);
  const ttlMs = normalizePositiveInteger(options.ttlMs, defaultTtlMs);
  const entries = new Map<string, StoredSlackStreamSourceContext>();

  function prune(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt > now) continue;
      entries.delete(key);
    }

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  return {
    put(context) {
      const now = Date.now();
      entries.set(streamSourceKey(context), {
        context,
        expiresAt: now + ttlMs,
      });
      prune(now);
    },
    get(input) {
      const key = streamSourceKey(input);
      const entry = entries.get(key);
      if (entry === undefined) return undefined;

      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }

      return entry.context;
    },
  };
}

function streamSourceKey(input: {
  readonly channelId: string;
  readonly messageTs: string;
}): string {
  return `${input.channelId}:${input.messageTs}`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value < 1 ? fallback : value;
}
