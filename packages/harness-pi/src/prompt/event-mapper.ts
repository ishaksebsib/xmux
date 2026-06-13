import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  HarnessPromptEvent,
  HarnessRunReason,
  HarnessTokenUsage,
  HarnessToolOutput,
  SessionRef,
} from "@xmux/harness-core";

export type PiPromptEvent = HarnessPromptEvent<"pi">;

export type PiPromptEventState = {
  readonly seenMessages: Set<string>;
  readonly startedContent: Set<string>;
  readonly completedContent: Set<string>;
  readonly startedTools: Set<string>;
  readonly inputCompletedTools: Set<string>;
  readonly calledTools: Set<string>;
  readonly completedTools: Set<string>;
};

export function createPiPromptEventState(): PiPromptEventState {
  return {
    seenMessages: new Set(),
    startedContent: new Set(),
    completedContent: new Set(),
    startedTools: new Set(),
    inputCompletedTools: new Set(),
    calledTools: new Set(),
    completedTools: new Set(),
  };
}

type MessageLike = {
  readonly role?: string;
  readonly timestamp?: number;
  readonly content?: unknown;
  readonly usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly totalTokens?: number;
    readonly cost?: { readonly total?: number };
  };
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly provider?: string;
  readonly model?: string;
};

type AssistantMessageEventLike = {
  readonly type: string;
  readonly contentIndex?: number;
  readonly delta?: string;
  readonly content?: string;
  readonly toolCall?: { readonly id?: string; readonly name?: string; readonly arguments?: unknown };
  readonly partial?: MessageLike;
  readonly message?: MessageLike;
  readonly error?: MessageLike;
  readonly reason?: string;
};

function messageLike(value: unknown): MessageLike {
  return typeof value === "object" && value !== null ? (value as MessageLike) : {};
}

function messageId(message: MessageLike, fallback: string): string {
  return `${message.role ?? "message"}:${message.timestamp ?? fallback}`;
}

function assistantMessageId(message: MessageLike | undefined, fallback: string): string {
  return messageId(message ?? {}, fallback);
}

function contentPartId(messageIdValue: string, index: number, kind: string): string {
  return `${messageIdValue}:${kind}:${index}`;
}

function toHarnessUsage(message: MessageLike | undefined): HarnessTokenUsage | undefined {
  const usage = message?.usage;
  if (!usage) return undefined;

  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.totalTokens,
  };
}

function runReason(reason: string | undefined): Exclude<HarnessRunReason, "error" | "aborted"> {
  switch (reason) {
    case "length":
      return "length";
    case "toolUse":
      return "tool_use";
    default:
      return "stop";
  }
}

function terminalRunEvent(args: {
  readonly ref: SessionRef<"pi">;
  readonly messages: readonly unknown[];
}): PiPromptEvent {
  const assistant = [...args.messages]
    .reverse()
    .map(messageLike)
    .find((message) => message.role === "assistant");

  if (assistant?.stopReason === "aborted") {
    return {
      type: "run",
      phase: "aborted",
      ref: args.ref,
      reason: "aborted",
      error: assistant.errorMessage,
    };
  }

  if (assistant?.stopReason === "error") {
    return {
      type: "run",
      phase: "failed",
      ref: args.ref,
      reason: "error",
      error: assistant.errorMessage ?? "Pi prompt failed",
    };
  }

  return {
    type: "run",
    phase: "completed",
    ref: args.ref,
    reason: runReason(assistant?.stopReason),
    usage: toHarnessUsage(assistant),
    cost: assistant?.usage?.cost?.total,
  };
}

function roleForMessage(message: MessageLike): "user" | "assistant" | "tool" | "system" | undefined {
  switch (message.role) {
    case "user":
    case "assistant":
      return message.role;
    case "toolResult":
      return "tool";
    default:
      return undefined;
  }
}

function* ensureMessageStarted(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly role: "user" | "assistant" | "tool" | "system";
  readonly messageId: string;
}): Generator<PiPromptEvent> {
  if (args.state.seenMessages.has(args.messageId)) return;
  args.state.seenMessages.add(args.messageId);
  yield {
    type: "message",
    phase: "started",
    ref: args.ref,
    role: args.role,
    messageId: args.messageId,
  };
}

function* mapMessageStart(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly message: MessageLike;
}): Generator<PiPromptEvent> {
  const role = roleForMessage(args.message);
  if (!role) return;

  yield* ensureMessageStarted({
    ref: args.ref,
    state: args.state,
    role,
    messageId: messageId(args.message, `${args.state.seenMessages.size}`),
  });
}

function* mapMessageEnd(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly message: MessageLike;
}): Generator<PiPromptEvent> {
  const role = roleForMessage(args.message);
  if (!role) return;

  const id = messageId(args.message, `${args.state.seenMessages.size}`);
  yield* ensureMessageStarted({ ref: args.ref, state: args.state, role, messageId: id });
  yield {
    type: "message",
    phase: "completed",
    ref: args.ref,
    role,
    messageId: id,
  };
}

function* ensureContentStarted(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly kind: "text" | "reasoning";
  readonly messageId: string;
  readonly partId: string;
  readonly index: number;
}): Generator<PiPromptEvent> {
  if (args.state.startedContent.has(args.partId)) return;
  args.state.startedContent.add(args.partId);
  yield {
    type: "content",
    phase: "started",
    ref: args.ref,
    kind: args.kind,
    messageId: args.messageId,
    partId: args.partId,
    index: args.index,
  };
}

function* mapContentDelta(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly kind: "text" | "reasoning";
  readonly messageId: string;
  readonly partId: string;
  readonly index: number;
  readonly delta: string;
}): Generator<PiPromptEvent> {
  yield* ensureContentStarted(args);
  if (args.delta.length === 0) return;
  yield {
    type: "content",
    phase: "delta",
    ref: args.ref,
    kind: args.kind,
    messageId: args.messageId,
    partId: args.partId,
    index: args.index,
    delta: args.delta,
  };
}

function* mapContentCompleted(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly kind: "text" | "reasoning";
  readonly messageId: string;
  readonly partId: string;
  readonly index: number;
  readonly text: string;
}): Generator<PiPromptEvent> {
  yield* ensureContentStarted(args);
  if (args.state.completedContent.has(args.partId)) return;
  args.state.completedContent.add(args.partId);
  yield {
    type: "content",
    phase: "completed",
    ref: args.ref,
    kind: args.kind,
    messageId: args.messageId,
    partId: args.partId,
    index: args.index,
    text: args.text,
  };
}

function toolCallFromPartial(
  event: AssistantMessageEventLike,
): { readonly id: string; readonly name?: string; readonly arguments?: unknown } {
  const index = event.contentIndex ?? 0;
  const fromPartial = Array.isArray(event.partial?.content)
    ? (event.partial.content[index] as { readonly id?: string; readonly name?: string; readonly arguments?: unknown } | undefined)
    : undefined;

  return {
    id: event.toolCall?.id ?? fromPartial?.id ?? `tool:${index}`,
    name: event.toolCall?.name ?? fromPartial?.name,
    arguments: event.toolCall?.arguments ?? fromPartial?.arguments,
  };
}

function* ensureToolStarted(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly callId: string;
  readonly name?: string;
}): Generator<PiPromptEvent> {
  if (args.state.startedTools.has(args.callId)) return;
  args.state.startedTools.add(args.callId);
  yield {
    type: "tool",
    phase: "input_started",
    ref: args.ref,
    callId: args.callId,
    name: args.name,
  };
}

function* ensureToolCalled(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
}): Generator<PiPromptEvent> {
  yield* ensureToolStarted(args);

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

function toToolOutput(result: unknown): readonly HarnessToolOutput[] {
  const record = typeof result === "object" && result !== null ? (result as { readonly content?: unknown; readonly details?: unknown }) : {};
  const output: HarnessToolOutput[] = [];

  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (typeof item !== "object" || item === null) continue;
      const content = item as { readonly type?: string; readonly text?: string; readonly data?: string; readonly mimeType?: string };
      if (content.type === "text" && content.text) output.push({ type: "text", text: content.text });
      if (content.type === "image" && content.data && content.mimeType) {
        output.push({ type: "image", data: content.data, mimeType: content.mimeType });
      }
    }
  }

  if (record.details !== undefined) output.push({ type: "json", value: record.details });
  return output;
}

function* mapAssistantMessageEvent(args: {
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
  readonly event: AssistantMessageEventLike;
}): Generator<PiPromptEvent> {
  const index = args.event.contentIndex ?? 0;
  const id = assistantMessageId(args.event.partial ?? args.event.message ?? args.event.error, "assistant");

  switch (args.event.type) {
    case "start":
      yield* ensureMessageStarted({ ref: args.ref, state: args.state, role: "assistant", messageId: id });
      return;
    case "text_start":
      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: id,
        partId: contentPartId(id, index, "text"),
        index,
      });
      return;
    case "text_delta":
      yield* mapContentDelta({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: id,
        partId: contentPartId(id, index, "text"),
        index,
        delta: args.event.delta ?? "",
      });
      return;
    case "text_end":
      yield* mapContentCompleted({
        ref: args.ref,
        state: args.state,
        kind: "text",
        messageId: id,
        partId: contentPartId(id, index, "text"),
        index,
        text: args.event.content ?? "",
      });
      return;
    case "thinking_start":
      yield* ensureContentStarted({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: id,
        partId: contentPartId(id, index, "thinking"),
        index,
      });
      return;
    case "thinking_delta":
      yield* mapContentDelta({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: id,
        partId: contentPartId(id, index, "thinking"),
        index,
        delta: args.event.delta ?? "",
      });
      return;
    case "thinking_end":
      yield* mapContentCompleted({
        ref: args.ref,
        state: args.state,
        kind: "reasoning",
        messageId: id,
        partId: contentPartId(id, index, "thinking"),
        index,
        text: args.event.content ?? "",
      });
      return;
    case "toolcall_start": {
      const tool = toolCallFromPartial(args.event);
      yield* ensureToolStarted({ ref: args.ref, state: args.state, callId: tool.id, name: tool.name });
      return;
    }
    case "toolcall_delta": {
      const tool = toolCallFromPartial(args.event);
      yield* ensureToolStarted({ ref: args.ref, state: args.state, callId: tool.id, name: tool.name });
      if (args.event.delta) {
        yield { type: "tool", phase: "input_delta", ref: args.ref, callId: tool.id, delta: args.event.delta };
      }
      return;
    }
    case "toolcall_end": {
      const tool = toolCallFromPartial(args.event);
      if (!tool.name) return;
      yield* ensureToolCalled({
        ref: args.ref,
        state: args.state,
        callId: tool.id,
        name: tool.name,
        input: tool.arguments,
      });
      return;
    }
    default:
      return;
  }
}

export function* mapPiSessionEvent(args: {
  readonly event: AgentSessionEvent;
  readonly ref: SessionRef<"pi">;
  readonly state: PiPromptEventState;
}): Generator<PiPromptEvent> {
  switch (args.event.type) {
    case "agent_start":
      yield { type: "run", phase: "started", ref: args.ref };
      return;
    case "agent_end":
      yield terminalRunEvent({ ref: args.ref, messages: args.event.messages });
      return;
    case "turn_start":
      yield { type: "turn", phase: "started", ref: args.ref };
      return;
    case "turn_end": {
      const message = messageLike(args.event.message);
      if (message.stopReason === "error") {
        yield {
          type: "turn",
          phase: "failed",
          ref: args.ref,
          error: message.errorMessage ?? "Pi turn failed",
        };
        return;
      }

      yield {
        type: "turn",
        phase: "completed",
        ref: args.ref,
        finish: message.stopReason,
        usage: toHarnessUsage(message),
        cost: message.usage?.cost?.total,
      };
      return;
    }
    case "message_start":
      yield* mapMessageStart({ ref: args.ref, state: args.state, message: messageLike(args.event.message) });
      return;
    case "message_update":
      yield* mapAssistantMessageEvent({
        ref: args.ref,
        state: args.state,
        event: args.event.assistantMessageEvent as AssistantMessageEventLike,
      });
      return;
    case "message_end":
      yield* mapMessageEnd({ ref: args.ref, state: args.state, message: messageLike(args.event.message) });
      return;
    case "tool_execution_start":
      yield* ensureToolCalled({
        ref: args.ref,
        state: args.state,
        callId: args.event.toolCallId,
        name: args.event.toolName,
        input: args.event.args,
      });
      return;
    case "tool_execution_update":
      yield {
        type: "tool",
        phase: "progress",
        ref: args.ref,
        callId: args.event.toolCallId,
        output: toToolOutput(args.event.partialResult),
      };
      return;
    case "tool_execution_end":
      if (args.state.completedTools.has(args.event.toolCallId)) return;
      args.state.completedTools.add(args.event.toolCallId);
      if (args.event.isError) {
        yield {
          type: "tool",
          phase: "failed",
          ref: args.ref,
          callId: args.event.toolCallId,
          error: args.event.result,
        };
        return;
      }

      yield {
        type: "tool",
        phase: "completed",
        ref: args.ref,
        callId: args.event.toolCallId,
        output: toToolOutput(args.event.result),
      };
      return;
    case "queue_update":
      yield {
        type: "queue",
        ref: args.ref,
        steeringCount: args.event.steering.length,
        followUpCount: args.event.followUp.length,
      };
      return;
    case "auto_retry_start":
      yield {
        type: "retry",
        ref: args.ref,
        attempt: args.event.attempt,
        maxAttempts: args.event.maxAttempts,
        error: args.event.errorMessage,
      };
      return;
    case "auto_retry_end":
    case "compaction_start":
    case "compaction_end":
    case "session_info_changed":
    case "thinking_level_changed":
      return;
  }
}
