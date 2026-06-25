import {
  Result,
  xmuxLogEvents,
  type Result as ResultType,
  type XmuxLogScope,
} from "@xmux/orchestrator";
import type { ChatAccessConfig } from "../../contracts/config";
import type { ServerXmuxMiddleware } from "./types";

const ACCESS_DENIED_REPLY = "Sorry, you are not allowed to use this bot.";

export interface ChatAccessPolicies {
  readonly telegram?: { readonly access: ChatAccessConfig };
  readonly discord?: { readonly access: ChatAccessConfig };
  readonly slack?: { readonly access: ChatAccessConfig };
}

export interface AccessControlEvent {
  readonly chatId: string;
  readonly conversation: { readonly conversationId: string };
  readonly reply?: (message: string) => Promise<unknown>;
}

export interface AccessControlMiddlewareContext {
  readonly handler: {
    readonly actor?: { readonly userId: string };
    readonly logger: Pick<XmuxLogScope, "warn">;
  };
  readonly event: AccessControlEvent;
  readonly route: { readonly name: string; readonly eventType: string };
}

export type AccessControlMiddlewareNext = () => Promise<ResultType<void, unknown>>;

export const accessForChat = (
  chats: ChatAccessPolicies,
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

export const createAccessControlMiddleware = (chats: ChatAccessPolicies): ServerXmuxMiddleware =>
  createAccessControlMiddlewareHandler(chats);

export const createAccessControlMiddlewareHandler =
  (chats: ChatAccessPolicies) =>
  async (
    ctx: AccessControlMiddlewareContext,
    next: AccessControlMiddlewareNext,
  ): Promise<ResultType<void, unknown>> => {
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

const replyDenied = async (event: AccessControlEvent): Promise<void> => {
  if (typeof event.reply !== "function") return;

  try {
    await event.reply(ACCESS_DENIED_REPLY);
  } catch {
    // Best-effort denial reply: access control must not fail route execution because reply failed.
  }
};
