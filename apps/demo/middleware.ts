import type { XmuxRoutedChatEvent } from "@xmux/core";
import { Result, type Result as BetterResult } from "better-result";

const RESTRICTED_TELEGRAM_USER_MESSAGE =
  "This demo bot is restricted to configured Telegram user ids.";

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
    next: () => Promise<BetterResult<void, unknown>>,
  ): Promise<BetterResult<void, unknown>> => {
    const actorId = ctx.handler.actor?.userId;
    if (
      ctx.event.chatId !== "telegram" ||
      (actorId !== undefined && allowedUserIds.has(actorId))
    ) {
      return next();
    }

    await (ctx.event as { readonly reply?: (message: string) => Promise<unknown> }).reply?.(
      RESTRICTED_TELEGRAM_USER_MESSAGE,
    );
    return Result.ok();
  };
}
