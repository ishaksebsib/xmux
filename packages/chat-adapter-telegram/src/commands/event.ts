import type {
  ChatAdapterCommandEvent,
  ChatCommandRegistry,
  ChatCommandValues,
} from "@xmux/chat-core";

export function createTelegramCommandEvent<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly actor: ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId>["actor"];
  readonly command: ChatCommandValues<TCommands>;
}): ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId> {
  return {
    type: "command",
    chatId: args.chatId,
    conversation: {
      chatId: args.chatId,
      conversationId: args.conversationId,
    },
    actor: args.actor,
    message: {
      chatId: args.chatId,
      conversationId: args.conversationId,
      messageId: args.messageId,
    },
    command: args.command,
  };
}
