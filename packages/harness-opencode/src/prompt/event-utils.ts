import type { AssistantMessage, Event as OpenCodeEvent } from "@opencode-ai/sdk/v2";
import { Result } from "better-result";
import type { HarnessRunReason, HarnessTokenUsage, HarnessToolOutput } from "@xmux/harness-core";
import type { TokenUsageInput } from "./types";

export function getEventSessionId(event: OpenCodeEvent): string | undefined {
  const properties = event.properties as {
    readonly sessionID?: string;
    readonly info?: { readonly sessionID?: string };
  };

  return properties.sessionID ?? properties.info?.sessionID;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toOpenCodeEvent(value: unknown): OpenCodeEvent | undefined {
  const payload = isRecord(value) && "payload" in value ? value.payload : value;

  if (!isRecord(payload) || typeof payload.type !== "string" || payload.type === "sync") {
    return undefined;
  }

  return payload as OpenCodeEvent;
}

export function toUsage(
  tokens: TokenUsageInput | AssistantMessage["tokens"] | undefined,
): HarnessTokenUsage | undefined {
  if (!tokens) return undefined;

  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache?.read,
    cacheWrite: tokens.cache?.write,
    total: tokens.total,
  };
}

export function toRunReason(
  finish: string | undefined,
): Exclude<HarnessRunReason, "error" | "aborted"> {
  switch (finish) {
    case "length":
      return "length";
    case "tool_use":
      return "tool_use";
    default:
      return "stop";
  }
}

export function toToolOutput(output: string | undefined): readonly HarnessToolOutput[] {
  return output === undefined || output.length === 0 ? [] : [{ type: "text", text: output }];
}

export function toToolOutputContent(
  content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
  )[],
  structured?: Record<string, unknown>,
): readonly HarnessToolOutput[] {
  const output: HarnessToolOutput[] = [];

  for (const item of content) {
    if (item.type === "text" && item.text.length > 0) {
      output.push({ type: "text", text: item.text });
      continue;
    }

    if (item.type === "file") {
      output.push({ type: "text", text: item.name ? `${item.name}: ${item.uri}` : item.uri });
    }
  }

  if (structured && Object.keys(structured).length > 0) {
    output.push({ type: "json", value: structured });
  }

  return output;
}

export function parseToolInput(text: string): unknown {
  return Result.unwrapOr(
    Result.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => text,
    }),
    text,
  );
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

export function isOpenCodeMessageAborted(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "MessageAbortedError"
  );
}

export function createStreamEndedError(): Error {
  return new Error("OpenCode event stream ended before the prompt run completed");
}
