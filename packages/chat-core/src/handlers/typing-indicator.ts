import { Result } from "better-result";
import {
  ChatTypingIndicatorError,
  InvalidChatTypingIndicatorInputError,
  UnsupportedChatOperationError,
  type ChatTypingIndicatorFailure,
} from "../errors";
import type {
  ChatAdapterDefinitions,
  ChatTypingIndicatorHandle,
  ChatTypingIndicatorInput,
  ChatTypingIndicatorResult,
} from "../types";
import type { GetStartedRuntime } from "./types";
import { createAdapterTypingIndicatorInput } from "./utils";

const defaultTypingIndicatorTimeoutMs = 60_000;
const defaultTypingIndicatorRefreshIntervalMs = 4_000;

type TypingIndicatorDiagnosticEmit<TChatId extends string> = (event: {
  readonly type: "diagnostic";
  readonly chatId: TChatId;
  readonly level: "info" | "warn";
  readonly code:
    | "CHAT_TYPING_INDICATOR_UNSUPPORTED_IGNORED"
    | "CHAT_TYPING_INDICATOR_REFRESH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}) => void;

/** Creates the facade typing indicator operation over adapter typing pulses. */
export function createTypingIndicatorHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>>(
  args: {
    readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
    readonly emit: TypingIndicatorDiagnosticEmit<Extract<keyof TAdapters, string>>;
    readonly getLifecycleSignal: () => AbortSignal | undefined;
  },
) {
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
        args.emit({
          type: "diagnostic",
          chatId: input.chatId,
          level: "info",
          code: "CHAT_TYPING_INDICATOR_UNSUPPORTED_IGNORED",
          message: `Chat adapter "${input.chatId}" does not support typing indicators; ignoring request.`,
        });
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
      return pulse.isErr()
        ? Result.err(pulse.error)
        : Result.ok(undefined as ChatTypingIndicatorResult<TInput>);
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
      sendPulse: async () => sendTypingPulse({ runtime, input }),
      emit: args.emit,
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

  return sent.value.isErr()
    ? Result.err(
        new ChatTypingIndicatorError({ chatId: args.input.chatId, cause: sent.value.error }),
      )
    : Result.ok();
}

function normalizeManagedTypingTiming(input: {
  readonly timeoutMs?: number;
  readonly refreshIntervalMs?: number;
}): Result<
  { readonly timeoutMs: number; readonly refreshIntervalMs: number },
  InvalidChatTypingIndicatorInputError
> {
  const timeoutMs = input.timeoutMs ?? defaultTypingIndicatorTimeoutMs;
  const refreshIntervalMs = input.refreshIntervalMs ?? defaultTypingIndicatorRefreshIntervalMs;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Result.err(
      new InvalidChatTypingIndicatorInputError({ field: "timeoutMs", value: timeoutMs }),
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

  return Result.ok({ timeoutMs, refreshIntervalMs });
}

function createManagedTypingIndicator<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatTypingIndicatorInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly timeoutMs: number;
  readonly refreshIntervalMs: number;
  readonly sendPulse: () => Promise<Result<void, ChatTypingIndicatorError>>;
  readonly emit: TypingIndicatorDiagnosticEmit<Extract<keyof TAdapters, string>>;
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
          args.emit({
            type: "diagnostic",
            chatId: args.input.chatId,
            level: "warn",
            code: "CHAT_TYPING_INDICATOR_REFRESH_FAILED",
            message: `Stopped managed typing indicator for "${args.input.chatId}" because a refresh pulse failed.`,
            cause: result.error,
          });
          stop();
        }
      })
      .catch((cause: unknown) => {
        if (!stopped) {
          args.emit({
            type: "diagnostic",
            chatId: args.input.chatId,
            level: "warn",
            code: "CHAT_TYPING_INDICATOR_REFRESH_FAILED",
            message: `Stopped managed typing indicator for "${args.input.chatId}" because a refresh pulse threw.`,
            cause,
          });
          stop();
        }
      })
      .finally(() => {
        inFlight = false;
      });
  };

  interval = setInterval(refresh, args.refreshIntervalMs);
  timeout = setTimeout(stop, args.timeoutMs);
  args.input.signal?.addEventListener("abort", stop, { once: true });
  args.lifecycleSignal?.addEventListener("abort", stop, { once: true });

  return { stop };
}

function createNoopTypingIndicatorResult(mode: "pulse" | "managed") {
  return mode === "managed" ? { stop() {} } : undefined;
}
