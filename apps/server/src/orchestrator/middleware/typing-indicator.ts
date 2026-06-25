import type { ChatTypingIndicatorHandle } from "@xmux/chat-core";
import { xmuxLogEvents, type Result as ResultType, type XmuxLogScope } from "@xmux/orchestrator";
import type { ServerXmuxMiddleware } from "./types";

const DEFAULT_TYPING_INDICATOR_DELAY_MS = 1_000;

export interface TypingIndicatorMiddlewareEvent {
  readonly chatId: string;
  readonly conversation: { readonly conversationId: string };
  readonly typingIndicator?: (options: {
    readonly mode: "managed";
    readonly fallback: "ignore";
  }) => Promise<ResultType<ChatTypingIndicatorHandle, unknown>>;
}

export interface TypingIndicatorMiddlewareContext {
  readonly handler: { readonly logger: Pick<XmuxLogScope, "debug"> };
  readonly event: TypingIndicatorMiddlewareEvent;
  readonly route: { readonly name: string; readonly eventType: string };
}

export type TypingIndicatorMiddlewareNext = () => Promise<ResultType<void, unknown>>;

const stopTyping = (handle: ChatTypingIndicatorHandle): void => {
  try {
    handle.stop();
  } catch {
    // Best-effort cleanup: typing indicator failures must not fail route execution.
  }
};

const logTypingFailure = (
  ctx: TypingIndicatorMiddlewareContext,
  reason: "typing_indicator_start_failed" | "typing_indicator_start_rejected",
): void => {
  ctx.handler.logger.debug(xmuxLogEvents.backgroundFailure, {
    chatId: ctx.event.chatId,
    routeName: ctx.route.name,
    eventType: ctx.route.eventType,
    conversationId: ctx.event.conversation.conversationId,
    reason,
  });
};

export const createTypingIndicatorMiddleware = (
  delayMs = DEFAULT_TYPING_INDICATOR_DELAY_MS,
): ServerXmuxMiddleware => createTypingIndicatorMiddlewareHandler(delayMs);

export const createTypingIndicatorMiddlewareHandler =
  (delayMs = DEFAULT_TYPING_INDICATOR_DELAY_MS) =>
  async (
    ctx: TypingIndicatorMiddlewareContext,
    next: TypingIndicatorMiddlewareNext,
  ): Promise<ResultType<void, unknown>> => {
    const typingIndicator = ctx.event.typingIndicator;
    if (typingIndicator === undefined) {
      return await next();
    }

    let finished = false;
    let handle: ChatTypingIndicatorHandle | undefined;
    let startCompleted: Promise<void> | undefined;

    const timer = setTimeout(() => {
      if (finished) return;

      startCompleted = Promise.resolve()
        .then(() => typingIndicator({ mode: "managed", fallback: "ignore" }))
        .then((result) => {
          if (result.isErr()) {
            logTypingFailure(ctx, "typing_indicator_start_failed");
            return;
          }

          if (finished) {
            stopTyping(result.value);
            return;
          }

          handle = result.value;
        })
        .catch(() => {
          logTypingFailure(ctx, "typing_indicator_start_rejected");
        });
    }, delayMs);

    try {
      return await next();
    } finally {
      finished = true;
      clearTimeout(timer);
      await startCompleted;
      if (handle !== undefined) stopTyping(handle);
    }
  };
