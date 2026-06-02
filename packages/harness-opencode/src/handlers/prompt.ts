import type {
  AssistantMessage,
  Event as OpenCodeEvent,
  FilePartInput,
  Part,
  TextPartInput,
} from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterPromptInput,
  HarnessAdapterPromptResult,
  HarnessContentKind,
  HarnessPromptEvent,
  HarnessRunReason,
  HarnessTokenUsage,
  HarnessToolOutput,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  OpenCodeModelSelectionError,
  OpenCodeSessionRequestError,
  OpenCodeSessionResponseError,
} from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { normalizeOpenCodeModelRef } from "./models";
import { applyThinkingToModel } from "./thinking";
import { describeResponseError, type OpenCodeCreateOptions } from "./utils";

type OpenCodePromptEvent = HarnessPromptEvent<"opencode">;
type OpenCodePromptPart = TextPartInput | FilePartInput;
type OpenCodeToolPart = Extract<Part, { readonly type: "tool" }>;
type EventFamily = "legacy" | "next";
type TokenUsageInput = {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
  readonly total?: number;
};
type SelectedOpenCodeModel = {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
};

type PromptStreamState = {
  readonly completedMessages: Set<string>;
  readonly completedParts: Set<string>;
  readonly completedTools: Set<string>;
  readonly inputCompletedTools: Set<string>;
  readonly calledTools: Set<string>;
  readonly messageRoles: Map<string, "user" | "assistant">;
  readonly partKinds: Map<string, HarnessContentKind>;
  readonly partTexts: Map<string, string>;
  readonly seenMessages: Set<string>;
  readonly seenParts: Set<string>;
  readonly seenTools: Set<string>;
  readonly toolInputs: Map<string, string>;
  readonly toolNames: Map<string, string>;
  currentNextCompactionPartId?: string;
  currentNextTextPartId?: string;
  currentNextTurnId?: string;
  eventFamily?: EventFamily;
  nextCompactionPartIndex: number;
  nextTextPartIndex: number;
  terminalRun: boolean;
  completedRun?: {
    readonly reason: Exclude<HarnessRunReason, "error" | "aborted">;
    readonly usage?: HarnessTokenUsage;
    readonly cost?: number;
  };
};

function createPromptStreamState(): PromptStreamState {
  return {
    completedMessages: new Set(),
    completedParts: new Set(),
    completedTools: new Set(),
    inputCompletedTools: new Set(),
    calledTools: new Set(),
    messageRoles: new Map(),
    partKinds: new Map(),
    partTexts: new Map(),
    seenMessages: new Set(),
    seenParts: new Set(),
    seenTools: new Set(),
    toolInputs: new Map(),
    toolNames: new Map(),
    nextCompactionPartIndex: 0,
    nextTextPartIndex: 0,
    terminalRun: false,
  };
}

function toPromptParts(
  content: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>["content"],
): OpenCodePromptPart[] {
  const parts: OpenCodePromptPart[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        if (part.text.length > 0) {
          parts.push({ type: "text", text: part.text });
        }
        break;
      case "image":
        parts.push({
          type: "file",
          mime: part.mimeType,
          filename: part.name,
          url: `data:${part.mimeType};base64,${part.data}`,
        });
        break;
      case "file":
        parts.push({
          type: "file",
          mime: part.mime,
          filename: part.name,
          url: part.uri,
        });
        break;
    }
  }

  return parts;
}

function getEventSessionId(event: OpenCodeEvent): string | undefined {
  const properties = event.properties as {
    readonly sessionID?: string;
    readonly info?: { readonly sessionID?: string };
  };

  return properties.sessionID ?? properties.info?.sessionID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOpenCodeEvent(value: unknown): OpenCodeEvent | undefined {
  const payload = isRecord(value) && "payload" in value ? value.payload : value;

  if (!isRecord(payload) || typeof payload.type !== "string" || payload.type === "sync") {
    return undefined;
  }

  return payload as OpenCodeEvent;
}

function toUsage(
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

function toRunReason(finish: string | undefined): Exclude<HarnessRunReason, "error" | "aborted"> {
  switch (finish) {
    case "length":
      return "length";
    case "tool_use":
      return "tool_use";
    default:
      return "stop";
  }
}

function toToolOutput(output: string | undefined): readonly HarnessToolOutput[] {
  return output === undefined || output.length === 0 ? [] : [{ type: "text", text: output }];
}

function toToolOutputContent(
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

function parseToolInput(text: string): unknown {
  const parsed = Result.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => text,
  });

  return parsed.isOk() ? parsed.value : text;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function isOpenCodeMessageAborted(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "MessageAbortedError"
  );
}

function createStreamEndedError(): Error {
  return new Error("OpenCode event stream ended before the prompt run completed");
}

function createResponseError(args: { readonly status: number; readonly error: unknown }) {
  return new OpenCodeSessionResponseError({
    status: args.status,
    detail: describeResponseError(args.error),
    reason: "OpenCode session prompt failed",
  });
}

function* ensureContentStarted(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly kind: HarnessContentKind;
  readonly messageId: string;
  readonly partId: string;
}): Generator<OpenCodePromptEvent> {
  args.state.partKinds.set(args.partId, args.kind);

  if (args.state.seenParts.has(args.partId)) return;

  args.state.seenParts.add(args.partId);
  yield {
    type: "content",
    phase: "started",
    ref: args.ref,
    kind: args.kind,
    messageId: args.messageId,
    partId: args.partId,
  };
}

function* mapTextPart(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly kind: HarnessContentKind;
  readonly messageId: string;
  readonly partId: string;
  readonly text: string;
  readonly completed: boolean;
}): Generator<OpenCodePromptEvent> {
  yield* ensureContentStarted(args);

  const previous = args.state.partTexts.get(args.partId) ?? "";
  const delta = args.text.startsWith(previous) ? args.text.slice(previous.length) : args.text;

  if (delta.length > 0) {
    yield {
      type: "content",
      phase: "delta",
      ref: args.ref,
      kind: args.kind,
      messageId: args.messageId,
      partId: args.partId,
      delta,
    };
  }

  args.state.partTexts.set(args.partId, args.text);

  if (args.completed && !args.state.completedParts.has(args.partId)) {
    args.state.completedParts.add(args.partId);
    yield {
      type: "content",
      phase: "completed",
      ref: args.ref,
      kind: args.kind,
      messageId: args.messageId,
      partId: args.partId,
      text: args.text,
    };
  }
}

function* ensureToolStarted(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly part: OpenCodeToolPart;
}): Generator<OpenCodePromptEvent> {
  if (args.state.seenTools.has(args.part.callID)) return;

  args.state.seenTools.add(args.part.callID);
  yield {
    type: "tool",
    phase: "input_started",
    ref: args.ref,
    callId: args.part.callID,
    name: args.part.tool,
  };
}

function* ensureToolCalled(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly part: OpenCodeToolPart;
}): Generator<OpenCodePromptEvent> {
  yield* ensureToolStarted(args);

  const raw = "raw" in args.part.state ? args.part.state.raw : undefined;
  if (raw !== undefined) {
    const previous = args.state.toolInputs.get(args.part.callID) ?? "";
    const delta = raw.startsWith(previous) ? raw.slice(previous.length) : raw;

    if (delta.length > 0) {
      args.state.toolInputs.set(args.part.callID, raw);
      yield {
        type: "tool",
        phase: "input_delta",
        ref: args.ref,
        callId: args.part.callID,
        delta,
      };
    }
  }

  if (!args.state.inputCompletedTools.has(args.part.callID)) {
    args.state.inputCompletedTools.add(args.part.callID);
    yield {
      type: "tool",
      phase: "input_completed",
      ref: args.ref,
      callId: args.part.callID,
      input: args.part.state.input,
    };
  }

  if (!args.state.calledTools.has(args.part.callID)) {
    args.state.calledTools.add(args.part.callID);
    yield {
      type: "tool",
      phase: "called",
      ref: args.ref,
      callId: args.part.callID,
      name: args.part.tool,
      input: args.part.state.input,
    };
  }
}

function* mapToolPart(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly part: OpenCodeToolPart;
}): Generator<OpenCodePromptEvent> {
  yield* ensureToolStarted(args);

  if (args.part.state.status === "pending") {
    const previous = args.state.toolInputs.get(args.part.callID) ?? "";
    const delta = args.part.state.raw.startsWith(previous)
      ? args.part.state.raw.slice(previous.length)
      : args.part.state.raw;

    if (delta.length > 0) {
      args.state.toolInputs.set(args.part.callID, args.part.state.raw);
      yield {
        type: "tool",
        phase: "input_delta",
        ref: args.ref,
        callId: args.part.callID,
        delta,
      };
    }

    return;
  }

  yield* ensureToolCalled(args);

  if (args.part.state.status === "running") {
    yield {
      type: "tool",
      phase: "progress",
      ref: args.ref,
      callId: args.part.callID,
    };
    return;
  }

  if (args.state.completedTools.has(args.part.callID)) return;

  args.state.completedTools.add(args.part.callID);

  if (args.part.state.status === "completed") {
    yield {
      type: "tool",
      phase: "completed",
      ref: args.ref,
      callId: args.part.callID,
      output: toToolOutput(args.part.state.output),
    };
    return;
  }

  yield {
    type: "tool",
    phase: "failed",
    ref: args.ref,
    callId: args.part.callID,
    error: args.part.state.error,
  };
}

function* mapPartUpdated(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly part: Part;
}): Generator<OpenCodePromptEvent> {
  switch (args.part.type) {
    case "text":
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: args.part.messageID,
        partId: args.part.id,
        text: args.part.text,
        completed: args.part.time?.end !== undefined,
      });
      return;
    case "reasoning":
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: args.part.messageID,
        partId: args.part.id,
        text: args.part.text,
        completed: args.part.time.end !== undefined,
      });
      return;
    case "tool":
      yield* mapToolPart({ ref: args.ref, state: args.state, part: args.part });
      return;
    case "step-start":
      yield {
        type: "turn",
        phase: "started",
        ref: args.ref,
        messageId: args.part.messageID,
        snapshot: args.part.snapshot,
      };
      return;
    case "step-finish":
      yield {
        type: "turn",
        phase: "completed",
        ref: args.ref,
        messageId: args.part.messageID,
        finish: args.part.reason,
        usage: toUsage(args.part.tokens),
        cost: args.part.cost,
        snapshot: args.part.snapshot,
      };
      return;
    case "snapshot":
    case "patch":
      return;
    case "retry":
      yield {
        type: "retry",
        ref: args.ref,
        attempt: args.part.attempt,
        error: args.part.error,
      };
      return;
    case "compaction":
      yield {
        type: "content",
        phase: "completed",
        ref: args.ref,
        kind: "compaction",
        messageId: args.part.messageID,
        partId: args.part.id,
        text: args.part.overflow === true ? "overflow" : args.part.auto ? "auto" : "manual",
      };
      return;
  }
}

function shouldProcessFamily(state: PromptStreamState, family: EventFamily): boolean {
  if (state.eventFamily && state.eventFamily !== family) return false;

  state.eventFamily = family;
  return true;
}

function startNextTextPart(state: PromptStreamState): string {
  const partId = `session-next-text-${state.nextTextPartIndex}`;
  state.nextTextPartIndex += 1;
  state.currentNextTextPartId = partId;
  return partId;
}

function getNextTextPart(state: PromptStreamState): string {
  return state.currentNextTextPartId ?? startNextTextPart(state);
}

function startNextCompactionPart(state: PromptStreamState): string {
  const partId = `session-next-compaction-${state.nextCompactionPartIndex}`;
  state.nextCompactionPartIndex += 1;
  state.currentNextCompactionPartId = partId;
  return partId;
}

function getNextCompactionPart(state: PromptStreamState): string {
  return state.currentNextCompactionPartId ?? startNextCompactionPart(state);
}

function* ensureNextToolStarted(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly callId: string;
  readonly name?: string;
}): Generator<OpenCodePromptEvent> {
  if (args.name) args.state.toolNames.set(args.callId, args.name);
  if (args.state.seenTools.has(args.callId)) return;

  args.state.seenTools.add(args.callId);
  yield {
    type: "tool",
    phase: "input_started",
    ref: args.ref,
    callId: args.callId,
    name: args.name,
  };
}

function* ensureNextToolCalled(args: {
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
}): Generator<OpenCodePromptEvent> {
  yield* ensureNextToolStarted(args);

  if (!args.state.inputCompletedTools.has(args.callId)) {
    args.state.inputCompletedTools.add(args.callId);
    yield {
      type: "tool",
      phase: "input_completed",
      ref: args.ref,
      callId: args.callId,
      input: args.input,
    };
  }

  if (!args.state.calledTools.has(args.callId)) {
    args.state.calledTools.add(args.callId);
    yield {
      type: "tool",
      phase: "called",
      ref: args.ref,
      callId: args.callId,
      name: args.name,
      input: args.input,
    };
  }
}

function* mapOpenCodeEvent(args: {
  readonly runtime: OpenCodeRuntime;
  readonly event: OpenCodeEvent;
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
}): Generator<OpenCodePromptEvent> {
  if (getEventSessionId(args.event) !== args.ref.sessionId) return;

  switch (args.event.type) {
    case "message.updated": {
      if (!shouldProcessFamily(args.state, "legacy")) return;

      const { info } = args.event.properties;
      args.state.messageRoles.set(info.id, info.role);

      if (!args.state.seenMessages.has(info.id)) {
        args.state.seenMessages.add(info.id);
        yield {
          type: "message",
          phase: "started",
          ref: args.ref,
          role: info.role,
          messageId: info.id,
        };

        if (info.role === "assistant") {
          const model = {
            providerId: info.providerID,
            modelId: info.modelID,
            ...(info.variant === undefined ? {} : { variant: info.variant }),
          };
          args.runtime.sessionModels.set(args.ref.sessionId, model);

          yield {
            type: "turn",
            phase: "started",
            ref: args.ref,
            messageId: info.id,
            agent: info.agent,
            model,
          };
        }
      } else if (!args.state.completedMessages.has(info.id)) {
        yield {
          type: "message",
          phase: "updated",
          ref: args.ref,
          role: info.role,
          messageId: info.id,
        };
      }

      if (info.role !== "assistant" || info.time.completed === undefined) return;

      if (!args.state.completedMessages.has(info.id)) {
        args.state.completedMessages.add(info.id);
        yield {
          type: "message",
          phase: "completed",
          ref: args.ref,
          role: "assistant",
          messageId: info.id,
        };
      }

      if (info.error) {
        args.state.terminalRun = true;
        if (isOpenCodeMessageAborted(info.error)) {
          yield {
            type: "run",
            phase: "aborted",
            ref: args.ref,
            reason: "aborted",
            error: info.error,
          };
          return;
        }

        yield {
          type: "turn",
          phase: "failed",
          ref: args.ref,
          messageId: info.id,
          error: info.error,
        };
        yield {
          type: "run",
          phase: "failed",
          ref: args.ref,
          reason: "error",
          error: info.error,
        };
        return;
      }

      const usage = toUsage(info.tokens);
      const reason = toRunReason(info.finish);
      args.state.completedRun = {
        reason,
        usage,
        cost: info.cost,
      };
      yield {
        type: "turn",
        phase: "completed",
        ref: args.ref,
        messageId: info.id,
        finish: info.finish,
        usage,
        cost: info.cost,
      };
      return;
    }
    case "message.removed": {
      if (!shouldProcessFamily(args.state, "legacy")) return;

      const role = args.state.messageRoles.get(args.event.properties.messageID);
      if (!role) return;

      yield {
        type: "message",
        phase: "removed",
        ref: args.ref,
        role,
        messageId: args.event.properties.messageID,
      };
      return;
    }
    case "message.part.updated":
      if (!shouldProcessFamily(args.state, "legacy")) return;

      yield* mapPartUpdated({ ref: args.ref, state: args.state, part: args.event.properties.part });
      return;
    case "message.part.removed":
      if (!shouldProcessFamily(args.state, "legacy")) return;

      args.state.completedParts.add(args.event.properties.partID);
      return;
    case "message.part.delta": {
      if (!shouldProcessFamily(args.state, "legacy")) return;

      const kind = args.state.partKinds.get(args.event.properties.partID) ?? "text";
      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind,
        messageId: args.event.properties.messageID,
        partId: args.event.properties.partID,
      });
      args.state.partTexts.set(
        args.event.properties.partID,
        `${args.state.partTexts.get(args.event.properties.partID) ?? ""}${args.event.properties.delta}`,
      );
      yield {
        type: "content",
        phase: "delta",
        ref: args.ref,
        kind,
        messageId: args.event.properties.messageID,
        partId: args.event.properties.partID,
        delta: args.event.properties.delta,
      };
      return;
    }
    case "permission.asked":
      yield {
        type: "interaction",
        kind: "permission",
        phase: "requested",
        ref: args.ref,
        requestId: args.event.properties.id,
        prompt: `${args.event.properties.permission}: ${args.event.properties.patterns.join(", ")}`,
        title: args.event.properties.permission,
        metadata: args.event.properties.metadata,
        permission: {
          name: args.event.properties.permission,
          patterns: args.event.properties.patterns,
          tool: args.event.properties.tool
            ? {
                messageId: args.event.properties.tool.messageID,
                callId: args.event.properties.tool.callID,
              }
            : undefined,
          allowAlways: args.event.properties.always.length > 0,
        },
      };
      return;
    case "permission.replied":
      yield {
        type: "interaction",
        kind: "permission",
        phase: args.event.properties.reply === "reject" ? "rejected" : "answered",
        ref: args.ref,
        requestId: args.event.properties.requestID,
      };
      return;
    case "question.asked":
      yield {
        type: "interaction",
        kind: "question",
        phase: "requested",
        ref: args.ref,
        requestId: args.event.properties.id,
        prompt: args.event.properties.questions.map((question) => question.question).join("\n"),
        question: {
          questions: args.event.properties.questions.map((question) => ({
            header: question.header,
            question: question.question,
            options: question.options.map((option) => ({
              label: option.label,
              description: option.description,
            })),
            multiple: question.multiple,
            custom: question.custom,
          })),
        },
      };
      return;
    case "question.replied":
      yield {
        type: "interaction",
        kind: "question",
        phase: "answered",
        ref: args.ref,
        requestId: args.event.properties.requestID,
      };
      return;
    case "question.rejected":
      yield {
        type: "interaction",
        kind: "question",
        phase: "rejected",
        ref: args.ref,
        requestId: args.event.properties.requestID,
      };
      return;
    case "session.next.model.switched": {
      if (!shouldProcessFamily(args.state, "next")) return;

      args.runtime.sessionModels.set(args.ref.sessionId, {
        providerId: args.event.properties.model.providerID,
        modelId: args.event.properties.model.id,
        variant: args.event.properties.model.variant,
      });
      return;
    }
    case "session.next.step.started": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const messageId = `session-next-step-${args.event.properties.timestamp}`;
      const model = {
        providerId: args.event.properties.model.providerID,
        modelId: args.event.properties.model.id,
        variant: args.event.properties.model.variant,
      };
      args.state.currentNextTurnId = messageId;
      args.runtime.sessionModels.set(args.ref.sessionId, model);
      yield {
        type: "turn",
        phase: "started",
        ref: args.ref,
        messageId,
        agent: args.event.properties.agent,
        model,
        snapshot: args.event.properties.snapshot,
      };
      return;
    }
    case "session.next.step.ended": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const usage = toUsage(args.event.properties.tokens);
      const reason = toRunReason(args.event.properties.finish);
      args.state.completedRun = {
        reason,
        usage,
        cost: args.event.properties.cost,
      };
      yield {
        type: "turn",
        phase: "completed",
        ref: args.ref,
        messageId: args.state.currentNextTurnId,
        finish: args.event.properties.finish,
        usage,
        cost: args.event.properties.cost,
        snapshot: args.event.properties.snapshot,
      };
      return;
    }
    case "session.next.step.failed":
      if (!shouldProcessFamily(args.state, "next")) return;

      args.state.terminalRun = true;
      yield {
        type: "turn",
        phase: "failed",
        ref: args.ref,
        messageId: args.state.currentNextTurnId,
        error: args.event.properties.error,
      };
      yield {
        type: "run",
        phase: "failed",
        ref: args.ref,
        reason: "error",
        error: args.event.properties.error,
      };
      return;
    case "session.next.text.started":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId: startNextTextPart(args.state),
      });
      return;
    case "session.next.text.delta": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const partId = getNextTextPart(args.state);
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId,
        text: `${args.state.partTexts.get(partId) ?? ""}${args.event.properties.delta}`,
        completed: false,
      });
      return;
    }
    case "session.next.text.ended": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const partId = getNextTextPart(args.state);
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId,
        text: args.event.properties.text,
        completed: true,
      });
      args.state.currentNextTextPartId = undefined;
      return;
    }
    case "session.next.reasoning.started":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId: args.event.properties.reasoningID,
      });
      return;
    case "session.next.reasoning.delta":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId: args.event.properties.reasoningID,
        text: `${args.state.partTexts.get(args.event.properties.reasoningID) ?? ""}${args.event.properties.delta}`,
        completed: false,
      });
      return;
    case "session.next.reasoning.ended":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId: args.event.properties.reasoningID,
        text: args.event.properties.text,
        completed: true,
      });
      return;
    case "session.next.tool.input.started":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureNextToolStarted({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name: args.event.properties.name,
      });
      return;
    case "session.next.tool.input.delta": {
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureNextToolStarted({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name: args.state.toolNames.get(args.event.properties.callID),
      });
      args.state.toolInputs.set(
        args.event.properties.callID,
        `${args.state.toolInputs.get(args.event.properties.callID) ?? ""}${args.event.properties.delta}`,
      );
      yield {
        type: "tool",
        phase: "input_delta",
        ref: args.ref,
        callId: args.event.properties.callID,
        delta: args.event.properties.delta,
      };
      return;
    }
    case "session.next.tool.input.ended": {
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureNextToolStarted({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name: args.state.toolNames.get(args.event.properties.callID),
      });
      args.state.toolInputs.set(args.event.properties.callID, args.event.properties.text);
      if (!args.state.inputCompletedTools.has(args.event.properties.callID)) {
        args.state.inputCompletedTools.add(args.event.properties.callID);
        yield {
          type: "tool",
          phase: "input_completed",
          ref: args.ref,
          callId: args.event.properties.callID,
          input: parseToolInput(args.event.properties.text),
        };
      }
      return;
    }
    case "session.next.tool.called":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureNextToolCalled({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name: args.event.properties.tool,
        input: args.event.properties.input,
      });
      return;
    case "session.next.tool.progress":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureNextToolStarted({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name: args.state.toolNames.get(args.event.properties.callID),
      });
      yield {
        type: "tool",
        phase: "progress",
        ref: args.ref,
        callId: args.event.properties.callID,
        output: toToolOutputContent(
          args.event.properties.content,
          args.event.properties.structured,
        ),
      };
      return;
    case "session.next.tool.success": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const name =
        args.state.toolNames.get(args.event.properties.callID) ?? args.event.properties.callID;
      const input = parseToolInput(args.state.toolInputs.get(args.event.properties.callID) ?? "{}");
      yield* ensureNextToolCalled({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name,
        input,
      });

      if (args.state.completedTools.has(args.event.properties.callID)) return;
      args.state.completedTools.add(args.event.properties.callID);
      yield {
        type: "tool",
        phase: "completed",
        ref: args.ref,
        callId: args.event.properties.callID,
        output: toToolOutputContent(
          args.event.properties.content,
          args.event.properties.structured,
        ),
      };
      return;
    }
    case "session.next.tool.failed": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const name =
        args.state.toolNames.get(args.event.properties.callID) ?? args.event.properties.callID;
      const input = parseToolInput(args.state.toolInputs.get(args.event.properties.callID) ?? "{}");
      yield* ensureNextToolCalled({
        ref: args.ref,
        state: args.state,
        callId: args.event.properties.callID,
        name,
        input,
      });

      if (args.state.completedTools.has(args.event.properties.callID)) return;
      args.state.completedTools.add(args.event.properties.callID);
      yield {
        type: "tool",
        phase: "failed",
        ref: args.ref,
        callId: args.event.properties.callID,
        error: args.event.properties.error,
      };
      return;
    }
    case "session.next.retried":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield {
        type: "retry",
        ref: args.ref,
        attempt: args.event.properties.attempt,
        error: args.event.properties.error,
      };
      return;
    case "session.next.compaction.started":
      if (!shouldProcessFamily(args.state, "next")) return;

      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind: "compaction",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId: startNextCompactionPart(args.state),
      });
      return;
    case "session.next.compaction.delta": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const partId = getNextCompactionPart(args.state);
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "compaction",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId,
        text: `${args.state.partTexts.get(partId) ?? ""}${args.event.properties.text}`,
        completed: false,
      });
      return;
    }
    case "session.next.compaction.ended": {
      if (!shouldProcessFamily(args.state, "next")) return;

      const partId = getNextCompactionPart(args.state);
      yield* mapTextPart({
        ref: args.ref,
        state: args.state,
        kind: "compaction",
        messageId: args.state.currentNextTurnId ?? args.ref.sessionId,
        partId,
        text: args.event.properties.text,
        completed: true,
      });
      args.state.currentNextCompactionPartId = undefined;
      return;
    }
    case "session.diff":
      return;
    case "session.error": {
      if (args.state.terminalRun) return;
      args.state.terminalRun = true;

      const error = args.event.properties.error ?? new Error("OpenCode session error");
      if (isOpenCodeMessageAborted(error)) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.ref,
          reason: "aborted",
          error,
        };
        return;
      }

      yield {
        type: "run",
        phase: "failed",
        ref: args.ref,
        reason: "error",
        error,
      };
      return;
    }
    case "session.idle":
      if (args.state.terminalRun) return;
      args.state.terminalRun = true;
      yield {
        type: "run",
        phase: "completed",
        ref: args.ref,
        reason: args.state.completedRun?.reason ?? "stop",
        usage: args.state.completedRun?.usage,
        cost: args.state.completedRun?.cost,
      };
      return;
    case "session.status":
      if (args.event.properties.status.type === "retry") {
        yield {
          type: "retry",
          ref: args.ref,
          attempt: args.event.properties.status.attempt,
          error: args.event.properties.status.message,
        };
      }
      return;
  }
}

async function sendPromptAsync(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>,
  parts: readonly OpenCodePromptPart[],
  model: SelectedOpenCodeModel | undefined,
) {
  return Result.tryPromise({
    try: () =>
      runtime.client.session.promptAsync(
        {
          sessionID: input.ref.sessionId,
          directory: input.cwd,
          workspace: input.adapterOptions.workspace,
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          variant: model?.variant,
          parts: [...parts],
        },
        { signal: input.signal },
      ),
    catch: (cause) => new OpenCodeSessionRequestError({ cause }),
  });
}

function createPromptEventStream(args: {
  readonly runtime: OpenCodeRuntime;
  readonly input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>;
  readonly parts: readonly OpenCodePromptPart[];
  readonly model?: SelectedOpenCodeModel;
}): HarnessAdapterPromptResult<"opencode"> {
  async function* eventStream(): AsyncIterable<OpenCodePromptEvent> {
    const state = createPromptStreamState();
    const streamAbort = new AbortController();
    let promptAccepted = false;
    const abortStream = () => {
      streamAbort.abort(args.input.signal?.reason);
      if (!promptAccepted) return;

      void args.runtime.client.session
        .abort({
          sessionID: args.input.ref.sessionId,
          workspace: args.input.adapterOptions.workspace,
        })
        .catch(() => undefined);
    };
    args.input.signal?.addEventListener("abort", abortStream, { once: true });

    try {
      if (args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error: args.input.signal.reason,
        };
        return;
      }

      const subscribed = await args.runtime.client.global.event({
        signal: streamAbort.signal,
        sseMaxRetryAttempts: 1,
      });
      const iterator = subscribed.stream[Symbol.asyncIterator]();
      let pendingEvent = iterator.next();

      yield {
        type: "run",
        phase: "started",
        ref: args.input.ref,
      };

      const prompted = await sendPromptAsync(args.runtime, args.input, args.parts, args.model);
      if (prompted.isErr()) {
        streamAbort.abort(prompted.error);
        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error: prompted.error,
        };
        return;
      }

      const status = prompted.value.response?.status ?? 0;
      if (prompted.value.error) {
        const error = createResponseError({ status, error: prompted.value.error });
        streamAbort.abort(error);
        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error,
        };
        return;
      }

      promptAccepted = true;

      while (!streamAbort.signal.aborted) {
        const next = await pendingEvent;
        if (next.done) break;

        pendingEvent = iterator.next();

        const event = toOpenCodeEvent(next.value);
        if (!event) {
          continue;
        }

        for (const promptEvent of mapOpenCodeEvent({
          runtime: args.runtime,
          event,
          ref: args.input.ref,
          state,
        })) {
          yield promptEvent;
        }

        if (state.terminalRun) {
          streamAbort.abort();
          await iterator.return?.(undefined);
          return;
        }
      }

      if (args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error: args.input.signal.reason,
        };
        return;
      }

      if (!state.terminalRun) {
        if (state.completedRun) {
          yield {
            type: "run",
            phase: "completed",
            ref: args.input.ref,
            reason: state.completedRun.reason,
            usage: state.completedRun.usage,
            cost: state.completedRun.cost,
          };
          return;
        }

        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error: createStreamEndedError(),
        };
      }
    } catch (error) {
      if (isAbortError(error) || args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error,
        };
        return;
      }

      yield {
        type: "run",
        phase: "failed",
        ref: args.input.ref,
        reason: "error",
        error,
      };
    } finally {
      args.input.signal?.removeEventListener("abort", abortStream);
      streamAbort.abort();
    }
  }

  return eventStream();
}

export async function prompt(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterPromptResult<"opencode">,
    OpenCodeModelSelectionError | OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  const selectedThinking =
    input.thinking ?? runtime.sessionThinking?.get(input.ref.sessionId) ?? runtime.defaultThinking;
  const selectedModel = applyThinkingToModel({
    runtime,
    model: input.model ?? runtime.sessionModels.get(input.ref.sessionId) ?? runtime.defaultModel,
    level: selectedThinking,
  });
  if (selectedModel.isErr()) return Result.err(selectedModel.error);

  const normalizedModel = selectedModel.value
    ? normalizeOpenCodeModelRef(selectedModel.value)
    : undefined;
  if (normalizedModel?.isErr()) return Result.err(normalizedModel.error);
  if (selectedModel.value) runtime.sessionModels.set(input.ref.sessionId, selectedModel.value);
  if (input.thinking) runtime.sessionThinking?.set(input.ref.sessionId, input.thinking);

  const parts = toPromptParts(input.content);
  const model = normalizedModel?.isOk() ? normalizedModel.value : undefined;
  return Result.ok(createPromptEventStream({ runtime, input, parts, model }));
}
