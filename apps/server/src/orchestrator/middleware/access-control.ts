import { Result, xmuxLogEvents } from "@xmux/orchestrator";
import type { ChatAccessConfig } from "../../contracts/config";
import type { EffectiveChatsConfig } from "../../config/effective";
import type { ServerXmuxMiddleware } from "./types";

const ACCESS_DENIED_REPLY = "Sorry, you are not allowed to use this bot.";

interface ReplyCapableEvent {
  readonly reply: (message: string) => Promise<unknown>;
}

const hasReply = (event: object): event is ReplyCapableEvent =>
  "reply" in event && typeof event.reply === "function";

export const accessForChat = (
  chats: EffectiveChatsConfig,
  chatId: string,
): ChatAccessConfig | undefined => {
  switch (chatId) {
    case "telegram":
      return chats.telegram?.access;
    case "discord":
      return chats.discord?.access;
    case "slack":
      return chats.slack?.access;
    default:
      return undefined;
  }
};

export const createAccessControlMiddleware =
  (chats: EffectiveChatsConfig): ServerXmuxMiddleware =>
  async (ctx, next) => {
    const access = accessForChat(chats, ctx.event.chatId);
    const actorUserId = ctx.handler.actor?.userId;

    if (access === undefined) {
      ctx.handler.logger.warn(xmuxLogEvents.routeIgnored, {
        chatId: ctx.event.chatId,
        routeName: ctx.route.name,
        eventType: ctx.route.eventType,
        conversationId: ctx.event.conversation.conversationId,
        actorUserId,
        reason: "unknown_chat_id",
      });
      await replyDenied(ctx.event);
      return Result.ok();
    }

    switch (access.type) {
      case "anyone":
        return await next();
      case "allow-list":
        if (actorUserId !== undefined && access.users.includes(actorUserId)) {
          return await next();
        }

        ctx.handler.logger.warn(xmuxLogEvents.routeIgnored, {
          chatId: ctx.event.chatId,
          routeName: ctx.route.name,
          eventType: ctx.route.eventType,
          conversationId: ctx.event.conversation.conversationId,
          actorUserId,
          reason: "access_denied",
        });
        await replyDenied(ctx.event);
        return Result.ok();
    }
  };

const replyDenied = async (event: object): Promise<void> => {
  if (!hasReply(event)) return;

  try {
    await event.reply(ACCESS_DENIED_REPLY);
  } catch {
    // Best-effort denial reply: access control must not fail route execution because reply failed.
  }
};
