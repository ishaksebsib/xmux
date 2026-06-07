import type { XmuxRoutedChatEvent } from "@xmux/core";
import { Result } from "better-result";

const restrictedResponse = (userId: string) =>
  `🪿 his demo bot is restricted to configured Telegram user ids.\n Add your user id to the list of allowed user ids in the demo bot's config. User ID: ${userId}`;

export function createTelegramAllowedUsersMiddleware(input: string | undefined) {
  const allowedUserIds = new Set(
    input
      ?.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0) ?? [],
  );

  return async (
    ctx: {
      readonly event: XmuxRoutedChatEvent;
      readonly handler: { readonly actor?: { readonly userId: string } };
    },
    next: () => Promise<Result<void, unknown>>,
  ): Promise<Result<void, unknown>> => {
    const actorId = ctx.handler.actor?.userId;
    if (ctx.event.chatId !== "telegram" || (actorId !== undefined && allowedUserIds.has(actorId))) {
      return next();
    }

    await (ctx.event as { readonly reply?: (message: string) => Promise<unknown> }).reply?.(
      restrictedResponse(actorId ?? "unenable to get user id"),
    );
    return Result.ok();
  };
}

export function createTelegramTypingIndicatorMiddleware() {
  return async (
    ctx: { readonly event: XmuxRoutedChatEvent },
    next: () => Promise<Result<void, unknown>>,
  ): Promise<Result<void, unknown>> => {
    const typingIndicator = (
      ctx.event as {
        readonly typingIndicator?: (options: {
          readonly mode: "managed";
          readonly fallback: "ignore";
        }) => Promise<Result<{ stop(): void }, unknown>>;
      }
    ).typingIndicator;
    const indicator =
      ctx.event.chatId === "telegram"
        ? await typingIndicator?.({ mode: "managed", fallback: "ignore" })
        : undefined;

    try {
      return await next();
    } finally {
      if (indicator?.isOk()) {
        indicator.value.stop();
      }
    }
  };
}
