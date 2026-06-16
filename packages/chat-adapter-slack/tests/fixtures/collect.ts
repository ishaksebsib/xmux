import type { ChatLogger, ChatLogMetadata } from "@xmux/chat-core";

export interface CapturedLog {
  readonly level: "trace" | "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly metadata?: ChatLogMetadata;
}

export function createMockLogger(): ChatLogger & { readonly logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];

  return {
    logs,
    trace: (event, metadata) => logs.push({ level: "trace", event, metadata }),
    debug: (event, metadata) => logs.push({ level: "debug", event, metadata }),
    info: (event, metadata) => logs.push({ level: "info", event, metadata }),
    warn: (event, metadata) => logs.push({ level: "warn", event, metadata }),
    error: (event, metadata) => logs.push({ level: "error", event, metadata }),
  };
}

export async function waitForCondition(
  condition: () => boolean,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const started = Date.now();

  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
