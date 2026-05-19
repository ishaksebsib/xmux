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
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { describeResponseError, type OpenCodeCreateOptions } from "./utils";

type OpenCodePromptEvent = HarnessPromptEvent<"opencode">;
type OpenCodePromptPart = TextPartInput | FilePartInput;
type OpenCodeToolPart = Extract<Part, { readonly type: "tool" }>;

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
  terminalRun: boolean;
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

function toUsage(tokens: AssistantMessage["tokens"] | undefined): HarnessTokenUsage | undefined {
  if (!tokens) return undefined;

  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
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
      yield {
        type: "workspace",
        phase: "snapshot",
        ref: args.ref,
        snapshot: args.part.snapshot,
      };
      return;
    case "patch":
      yield {
        type: "workspace",
        phase: "file",
        ref: args.ref,
        files: args.part.files,
      };
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

function* mapOpenCodeEvent(args: {
  readonly event: OpenCodeEvent;
  readonly ref: { readonly harnessId: "opencode"; readonly sessionId: string };
  readonly state: PromptStreamState;
}): Generator<OpenCodePromptEvent> {
  if (getEventSessionId(args.event) !== args.ref.sessionId) return;

  switch (args.event.type) {
    case "message.updated": {
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
          yield {
            type: "turn",
            phase: "started",
            ref: args.ref,
            messageId: info.id,
            agent: info.agent,
            model: {
              providerId: info.providerID,
              modelId: info.modelID,
              variant: info.variant,
            },
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

      args.state.terminalRun = true;
      yield {
        type: "turn",
        phase: "completed",
        ref: args.ref,
        messageId: info.id,
        finish: info.finish,
        usage: toUsage(info.tokens),
        cost: info.cost,
      };
      yield {
        type: "run",
        phase: "completed",
        ref: args.ref,
        reason: toRunReason(info.finish),
        usage: toUsage(info.tokens),
        cost: info.cost,
      };
      return;
    }
    case "message.removed": {
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
      yield* mapPartUpdated({ ref: args.ref, state: args.state, part: args.event.properties.part });
      return;
    case "message.part.removed":
      args.state.completedParts.add(args.event.properties.partID);
      return;
    case "message.part.delta": {
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
    case "session.diff":
      yield {
        type: "workspace",
        phase: "diff",
        ref: args.ref,
        diff: args.event.properties.diff.map((entry) => entry.patch).join("\n"),
        files: args.event.properties.diff.map((entry) => entry.file),
      };
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
        reason: "stop",
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
) {
  return Result.tryPromise({
    try: () =>
      runtime.client.session.promptAsync(
        {
          sessionID: input.ref.sessionId,
          workspace: input.adapterOptions.workspace,
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
}): HarnessAdapterPromptResult<"opencode"> {
  async function* eventStream(): AsyncIterable<OpenCodePromptEvent> {
    const state = createPromptStreamState();
    const streamAbort = new AbortController();
    const abortStream = () => streamAbort.abort(args.input.signal?.reason);
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

      const subscribed = await args.runtime.client.event.subscribe(
        { workspace: args.input.adapterOptions.workspace },
        { signal: streamAbort.signal, sseMaxRetryAttempts: 1 },
      );
      const iterator = subscribed.stream[Symbol.asyncIterator]();
      let pendingEvent = iterator.next();

      yield {
        type: "run",
        phase: "started",
        ref: args.input.ref,
      };

      const prompted = await sendPromptAsync(args.runtime, args.input, args.parts);
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

      while (!streamAbort.signal.aborted) {
        const next = await pendingEvent;
        if (next.done) break;

        pendingEvent = iterator.next();

        for (const event of mapOpenCodeEvent({
          event: next.value,
          ref: args.input.ref,
          state,
        })) {
          yield event;
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
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  const parts = toPromptParts(input.content);
  return Result.ok(createPromptEventStream({ runtime, input, parts }));
}
