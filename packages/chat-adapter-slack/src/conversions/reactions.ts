import type { ChatReactionAddedEvent, ChatReactionRemovedEvent } from "@xmux/chat-core";
import type { SlackBotIdentity, SlackReactionEvent } from "../client";

export type SlackReactionDecodeResult<TChatId extends string> =
  | {
      readonly status: "event";
      readonly event: ChatReactionAddedEvent<TChatId> | ChatReactionRemovedEvent<TChatId>;
    }
  | { readonly status: "ignored"; readonly reason: "non_message_item" | "self_reaction" };

interface SlackReactionLike {
  readonly type: "reaction_added" | "reaction_removed";
  readonly item?: {
    readonly type?: string;
    readonly channel?: string;
    readonly ts?: string;
  };
  readonly reaction?: string;
  readonly user?: string;
}

export function decodeSlackReactionEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly event: SlackReactionEvent["event"];
  readonly botIdentity?: SlackBotIdentity;
}): SlackReactionDecodeResult<TChatId> {
  const event = args.event as SlackReactionLike;

  if (args.botIdentity?.botUserId !== undefined && event.user === args.botIdentity.botUserId) {
    return { status: "ignored", reason: "self_reaction" };
  }

  if (
    event.item?.type !== "message" ||
    event.item.channel === undefined ||
    event.item.ts === undefined ||
    event.reaction === undefined
  ) {
    return { status: "ignored", reason: "non_message_item" };
  }

  return {
    status: "event",
    event: {
      type: event.type === "reaction_added" ? "reaction.added" : "reaction.removed",
      chatId: args.chatId,
      message: {
        chatId: args.chatId,
        conversationId: event.item.channel,
        messageId: event.item.ts,
      },
      actor:
        event.user === undefined
          ? undefined
          : {
              kind: "user",
              actorId: event.user,
              adapterData: {},
            },
      reaction: event.reaction,
    },
  };
}
