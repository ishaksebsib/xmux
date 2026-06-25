import type { ChatTypingIndicatorHandle } from "@xmux/chat-core";
import { Result, xmuxLogEvents } from "@xmux/orchestrator";
import type { ServerXmuxMiddleware } from "./types";

const DEFAULT_TYPING_INDICATOR_DELAY_MS = 1_000;

interface TypingIndicatorCapableEvent {
  readonly typingIndicator: (options: {
    readonly mode: "managed";
    readonly fallback: "ignore";
  }) => Promise<Result<ChatTypingIndicatorHandle, unknown>>;
}

const hasTypingIndicator = (event: object): event is TypingIndicatorCapableEvent =>
  "typingIndicator" in event && typeof event.typingIndicator === "function";

export const createTypingIndicatorMiddleware =
  (delayMs = DEFAULT_TYPING_INDICATOR_DELAY_MS): ServerXmuxMiddleware =>
  async (ctx, next) => {
    if (!hasTypingIndicator(ctx.event)) {
      return await next();
    }

    const typingIndicator = ctx.event.typingIndicator;
    let finished = false;
    let handle: ChatTypingIndicatorHandle | undefined;
    let startCompleted: Promise<void> | undefined;

    const timer = setTimeout(() => {
      if (finished) return;

      startCompleted = typingIndicator({ mode: "managed", fallback: "ignore" })
        .then((result) => {
          if (result.isErr()) {
            ctx.handler.logger.debug(xmuxLogEvents.backgroundFailure, {
              chatId: ctx.event.chatId,
              routeName: ctx.route.name,
              eventType: ctx.route.eventType,
              conversationId: ctx.event.conversation.conversationId,
              reason: "typing_indicator_start_failed",
            });
            return;
          }

          if (finished) {
            result.value.stop();
            return;
          }

          handle = result.value;
        })
        .catch(() => {
          ctx.handler.logger.debug(xmuxLogEvents.backgroundFailure, {
            chatId: ctx.event.chatId,
            routeName: ctx.route.name,
            eventType: ctx.route.eventType,
            conversationId: ctx.event.conversation.conversationId,
            reason: "typing_indicator_start_rejected",
          });
        });
    }, delayMs);

    try {
      return await next();
    } finally {
      finished = true;
      clearTimeout(timer);
      await startCompleted;
      handle?.stop();
    }
  };
