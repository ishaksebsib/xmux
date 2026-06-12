import { Result } from "better-result";
import {
  ChatTypingIndicatorError,
  InvalidChatTypingIndicatorInputError,
  UnsupportedChatOperationError,
  type ChatTypingIndicatorFailure,
} from "../errors";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type {
  ChatTypingIndicatorHandle,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
} from "../inputs";
import type { GetStartedRuntime } from "./types";
import { createAdapterTypingIndicatorInput } from "./adapter-inputs";

const defaultTypingIndicatorRefreshIntervalMs = 4_000;

/** Creates the facade typing indicator operation over adapter typing pulses. */
export function createTypingIndicatorHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly getLifecycleSignal: () => AbortSignal | undefined;
}) {
  return async function typingIndicator<TInput extends ChatTypingIndicatorInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatTypingIndicatorResult<TInput>, ChatTypingIndicatorFailure>> {
    const runtimeResult = await args.getStartedRuntime({
      chatId: input.chatId,
      operation: "typingIndicator",
    });
    if (runtimeResult.isErr()) {
      return Result.err(runtimeResult.error);
    }

    const runtime = runtimeResult.value;
    const fallback = input.fallback ?? "error";
    const mode = input.mode ?? "pulse";

    if (runtime.sendTyping === undefined) {
      if (fallback === "ignore") {
        return Result.ok(
          createNoopTypingIndicatorResult(mode) as ChatTypingIndicatorResult<TInput>,
        );
      }

      return Result.err(
        new UnsupportedChatOperationError({
          chatId: input.chatId,
          operation: "typingIndicator",
          mode,
        }),
      );
    }

    if (mode === "pulse") {
      const pulse = await sendTypingPulse({ runtime, input });
      return Result.map(pulse, () => undefined) as Result<
        ChatTypingIndicatorResult<TInput>,
        ChatTypingIndicatorFailure
      >;
    }

    const timing = normalizeManagedTypingTiming({
      timeoutMs: "timeoutMs" in input ? input.timeoutMs : undefined,
      refreshIntervalMs: "refreshIntervalMs" in input ? input.refreshIntervalMs : undefined,
    });
    if (timing.isErr()) {
      return Result.err(timing.error);
    }

    const firstPulse = await sendTypingPulse({ runtime, input });
    if (firstPulse.isErr()) {
      return Result.err(firstPulse.error);
    }

    const handle = createManagedTypingIndicator({
      input,
      timeoutMs: timing.value.timeoutMs,
      refreshIntervalMs: timing.value.refreshIntervalMs,
      sendPulse: () => sendTypingPulse({ runtime, input }),
      lifecycleSignal: args.getLifecycleSignal(),
    });

    return Result.ok(handle as ChatTypingIndicatorResult<TInput>);
  };
}

async function sendTypingPulse<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatTypingIndicatorInput<TAdapters>,
>(args: {
  readonly runtime: {
    readonly sendTyping?: (
      input: ReturnType<typeof createAdapterTypingIndicatorInput<TAdapters, TInput>>,
    ) => Promise<Result<void, unknown>>;
  };
  readonly input: TInput;
}): Promise<Result<void, ChatTypingIndicatorError>> {
  const adapterInput = createAdapterTypingIndicatorInput<TAdapters, TInput>(args.input);
  const sent = await Result.tryPromise({
    try: async () => args.runtime.sendTyping?.(adapterInput),
    catch: (cause) => new ChatTypingIndicatorError({ chatId: args.input.chatId, cause }),
  });

  if (sent.isErr()) {
    return Result.err(sent.error);
  }

  if (sent.value === undefined) {
    return Result.err(
      new ChatTypingIndicatorError({
        chatId: args.input.chatId,
        cause: new TypeError("Adapter sendTyping method disappeared during typing indicator call"),
      }),
    );
  }

  return Result.mapError(
    sent.value,
    (cause) => new ChatTypingIndicatorError({ chatId: args.input.chatId, cause }),
  );
}

function normalizeManagedTypingTiming(input: {
  readonly timeoutMs?: number;
  readonly refreshIntervalMs?: number;
}): Result<
  { readonly timeoutMs?: number; readonly refreshIntervalMs: number },
  InvalidChatTypingIndicatorInputError
> {
  const refreshIntervalMs = input.refreshIntervalMs ?? defaultTypingIndicatorRefreshIntervalMs;

  if (
    input.timeoutMs !== undefined &&
    (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)
  ) {
    return Result.err(
      new InvalidChatTypingIndicatorInputError({ field: "timeoutMs", value: input.timeoutMs }),
    );
  }

  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) {
    return Result.err(
      new InvalidChatTypingIndicatorInputError({
        field: "refreshIntervalMs",
        value: refreshIntervalMs,
      }),
    );
  }

  return Result.ok({
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    refreshIntervalMs,
  });
}

function createManagedTypingIndicator<TInput extends { readonly signal?: AbortSignal }>(args: {
  readonly input: TInput;
  readonly timeoutMs?: number;
  readonly refreshIntervalMs: number;
  readonly sendPulse: () => Promise<Result<void, ChatTypingIndicatorError>>;
  readonly lifecycleSignal?: AbortSignal;
}): ChatTypingIndicatorHandle {
  let stopped = false;
  let inFlight = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (interval !== undefined) {
      clearInterval(interval);
    }
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    args.input.signal?.removeEventListener("abort", stop);
    args.lifecycleSignal?.removeEventListener("abort", stop);
  };

  const refresh = () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    void args
      .sendPulse()
      .then((result) => {
        if (result.isErr() && !stopped) {
          stop();
        }
      })
      .catch(() => {
        if (!stopped) {
          stop();
        }
      })
      .finally(() => {
        inFlight = false;
      });
  };

  interval = setInterval(refresh, args.refreshIntervalMs);
  if (args.timeoutMs !== undefined) {
    timeout = setTimeout(stop, args.timeoutMs);
  }
  args.input.signal?.addEventListener("abort", stop, { once: true });
  args.lifecycleSignal?.addEventListener("abort", stop, { once: true });

  return { stop };
}

function createNoopTypingIndicatorResult(mode: "pulse" | "managed") {
  return mode === "managed" ? { stop() {} } : undefined;
}
