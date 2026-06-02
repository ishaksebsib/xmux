import type { ChatTextStreamChunk } from "@xmux/chat-core";
import type { HarnessPromptEvent, HarnessToolOutput } from "@xmux/harness-core";
import {
  markdownText,
  promptInteraction,
  promptReasoning,
  promptRetry,
  promptTool,
  type PromptToolOutputComponentInput,
} from "../../components";

interface PromptRenderState {
  emitted: boolean;
  emittedAssistantText: boolean;
  currentTextPart?: string;
  readonly textPartsWithDelta: Set<string>;
  readonly completedTextParts: Set<string>;
  readonly reasoningText: Map<string, string>;
  readonly completedReasoningParts: Set<string>;
  readonly toolNames: Map<string, string>;
  readonly toolInputs: Map<string, unknown>;
  readonly toolRawInputs: Map<string, string>;
  readonly completedTools: Set<string>;
  readonly failedTools: Set<string>;
  readonly interactionPhases: Set<string>;
  readonly retries: Set<string>;
  toolCallsHeaderEmitted: boolean;
}

export interface PromptEventRenderer {
  render(event: HarnessPromptEvent): string;
  resetMessageBoundary(): void;
}

function createPromptRenderState(): PromptRenderState {
  return {
    emitted: false,
    emittedAssistantText: false,
    textPartsWithDelta: new Set(),
    completedTextParts: new Set(),
    reasoningText: new Map(),
    completedReasoningParts: new Set(),
    toolNames: new Map(),
    toolInputs: new Map(),
    toolRawInputs: new Map(),
    completedTools: new Set(),
    failedTools: new Set(),
    interactionPhases: new Set(),
    retries: new Set(),
    toolCallsHeaderEmitted: false,
  };
}

/**
 * Renders harness prompt events into append-only markdown chunks.
 *
 * Telegram/Discord/Slack streaming APIs are commonly append-only, so this renderer never rewrites
 * earlier output. Ephemeral states like "thinking" or "tool pending" are kept internal and only
 * emitted once they become stable enough to avoid stuck UI text.
 */
export function createPromptEventRenderer(): PromptEventRenderer {
  const state = createPromptRenderState();

  return {
    render(event) {
      return renderPromptEvent({ event, state });
    },
    resetMessageBoundary() {
      state.emitted = false;
      state.emittedAssistantText = false;
      state.currentTextPart = undefined;
      state.toolCallsHeaderEmitted = false;
    },
  };
}

export async function* renderPromptEvents(
  events: AsyncIterable<HarnessPromptEvent>,
): AsyncIterable<ChatTextStreamChunk> {
  const renderer = createPromptEventRenderer();

  for await (const event of events) {
    const rendered = renderer.render(event);
    if (rendered.length === 0) continue;
    yield { type: "delta", delta: rendered };
  }

  yield { type: "completed" };
}

function renderPromptEvent(input: {
  readonly event: HarnessPromptEvent;
  readonly state: PromptRenderState;
}): string {
  const { event, state } = input;

  switch (event.type) {
    case "content":
      return renderContentEvent({ event, state });
    case "tool":
      return renderToolEvent({ event, state });
    case "interaction":
      return renderInteractionEvent({ event, state });
    case "queue":
      return appendBlock(
        state,
        `_${markdownText(
          `Queued steering: ${event.steeringCount}, follow-ups: ${event.followUpCount}`,
        )}_`,
      );
    case "retry":
      return renderRetryEvent({ event, state });
    case "run":
      return renderRunEvent({ event, state });
    case "turn":
      return renderTurnEvent({ event, state });
    case "message":
    case "native":
      return "";
  }

  return "";
}

function renderContentEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "content" }>;
  readonly state: PromptRenderState;
}): string {
  const key = contentPartKey(input.event);

  if (input.event.phase === "started") {
    return "";
  }

  if (input.event.phase === "delta") {
    if (input.event.kind === "text") {
      input.state.textPartsWithDelta.add(key);
      return appendTextDelta(input.state, key, input.event.delta);
    }

    if (input.event.kind === "reasoning") {
      input.state.reasoningText.set(
        key,
        `${input.state.reasoningText.get(key) ?? ""}${input.event.delta}`,
      );
    }

    return "";
  }

  if (input.state.completedTextParts.has(key)) {
    return "";
  }

  input.state.completedTextParts.add(key);

  if (input.event.kind === "text") {
    return input.state.textPartsWithDelta.has(key)
      ? ""
      : appendTextDelta(input.state, key, input.event.text);
  }

  if (input.event.kind === "reasoning") {
    if (input.state.completedReasoningParts.has(key)) return "";
    input.state.completedReasoningParts.add(key);
    input.state.reasoningText.set(key, input.event.text);
    return input.event.text.trim().length === 0
      ? ""
      : appendBlock(input.state, promptReasoning({ text: input.event.text, status: "done" }));
  }

  if (input.event.kind === "compaction") {
    return appendBlock(input.state, `_${markdownText(`Context compacted: ${input.event.text}`)}_`);
  }

  if (input.event.kind === "structured" && input.event.text.trim().length > 0) {
    return appendBlock(input.state, markdownText(input.event.text));
  }

  return "";
}

function renderToolEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "tool" }>;
  readonly state: PromptRenderState;
}): string {
  const { event, state } = input;

  switch (event.phase) {
    case "input_started":
      if (event.name) state.toolNames.set(event.callId, event.name);
      return "";
    case "input_delta":
      state.toolRawInputs.set(
        event.callId,
        `${state.toolRawInputs.get(event.callId) ?? ""}${event.delta}`,
      );
      return "";
    case "input_completed":
      state.toolInputs.set(event.callId, event.input);
      return "";
    case "called":
      state.toolNames.set(event.callId, event.name);
      state.toolInputs.set(event.callId, event.input);
      return "";
    case "progress":
      return "";
    case "completed": {
      if (state.completedTools.has(event.callId)) return "";
      state.completedTools.add(event.callId);
      return appendToolCall(
        state,
        promptTool({
          callId: event.callId,
          name: state.toolNames.get(event.callId),
          input: state.toolInputs.get(event.callId),
          rawInput: state.toolRawInputs.get(event.callId),
          status: "completed",
          output: event.output.map(toToolOutputComponent),
        }),
      );
    }
    case "failed": {
      if (state.failedTools.has(event.callId)) return "";
      state.failedTools.add(event.callId);
      return appendToolCall(
        state,
        promptTool({
          callId: event.callId,
          name: state.toolNames.get(event.callId),
          input: state.toolInputs.get(event.callId),
          rawInput: state.toolRawInputs.get(event.callId),
          status: "failed",
          error: event.error,
        }),
      );
    }
  }
}

function renderInteractionEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "interaction" }>;
  readonly state: PromptRenderState;
}): string {
  if (input.event.phase !== "requested") return "";

  const key = `${input.event.kind}:${input.event.requestId}:${input.event.phase}`;
  if (input.state.interactionPhases.has(key)) return "";

  input.state.interactionPhases.add(key);
  return appendBlock(
    input.state,
    promptInteraction({
      kind: input.event.kind,
      phase: input.event.phase,
      prompt: input.event.phase === "requested" ? input.event.prompt : undefined,
      title: input.event.phase === "requested" ? input.event.title : undefined,
      permission: input.event.phase === "requested" ? input.event.permission : undefined,
      question: input.event.phase === "requested" ? input.event.question : undefined,
    }),
  );
}

function renderRetryEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "retry" }>;
  readonly state: PromptRenderState;
}): string {
  const key = `${input.event.attempt}:${input.event.maxAttempts ?? ""}:${describeUnknown(input.event.error)}`;
  if (input.state.retries.has(key)) return "";

  input.state.retries.add(key);
  return appendBlock(input.state, promptRetry(input.event));
}

function renderRunEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "run" }>;
  readonly state: PromptRenderState;
}): string {
  if (input.event.phase === "started") return "";

  if (input.event.phase === "completed") {
    return input.state.emitted ? "" : appendBlock(input.state, "_Done._");
  }

  if (input.event.phase === "aborted") {
    const description = describeUnknown(input.event.error);
    if (description === "Generation cancelled") return "";

    const error = description.length === 0 ? "" : `\n\n${markdownText(description)}`;
    return appendBlock(input.state, `**Prompt aborted**${error}`);
  }

  return appendBlock(
    input.state,
    `**Prompt failed**\n\n${markdownText(describeUnknown(input.event.error))}`,
  );
}

function renderTurnEvent(input: {
  readonly event: Extract<HarnessPromptEvent, { readonly type: "turn" }>;
  readonly state: PromptRenderState;
}): string {
  if (input.event.phase !== "failed") return "";
  return appendBlock(
    input.state,
    `**Turn failed**\n\n${markdownText(describeUnknown(input.event.error))}`,
  );
}

function appendTextDelta(state: PromptRenderState, partId: string, delta: string): string {
  if (delta.length === 0) return "";

  const prefix = state.emitted && state.currentTextPart !== partId ? "\n\n" : "";
  state.emitted = true;
  state.emittedAssistantText = true;
  state.currentTextPart = partId;
  return `${prefix}${delta}`;
}

function appendBlock(state: PromptRenderState, block: string): string {
  if (block.trim().length === 0) return "";

  const prefix = state.emitted ? "\n\n" : "";
  state.emitted = true;
  state.currentTextPart = undefined;
  return `${prefix}${block}`;
}

function appendToolCall(state: PromptRenderState, block: string): string {
  if (block.trim().length === 0) return "";

  const header = state.toolCallsHeaderEmitted ? "" : "**Tool calls**\n";
  state.toolCallsHeaderEmitted = true;
  return appendBlock(state, blockquote(`${header}${block}`));
}

function blockquote(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function contentPartKey(event: Extract<HarnessPromptEvent, { readonly type: "content" }>): string {
  return [event.kind, event.messageId ?? "message", event.partId ?? event.index ?? "part"].join(
    ":",
  );
}

function toToolOutputComponent(output: HarnessToolOutput): PromptToolOutputComponentInput {
  switch (output.type) {
    case "text":
      return { type: "text", text: output.text };
    case "json":
      return { type: "json", value: output.value };
    case "image":
      return { type: "image", mimeType: output.mimeType, dataLength: output.data.length };
  }
}

function describeUnknown(value: unknown): string {
  if (value === undefined) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
