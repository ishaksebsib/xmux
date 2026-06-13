import type {
  ChatActor,
  ChatAdapterCommandEvent,
  ChatAdapterInvalidCommandEvent,
  ChatAdapterUnknownCommandEvent,
  ChatCommandRegistry,
  ChatCommandValues,
} from "@xmux/chat-core";

export function createDiscordCommandEvent<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly interactionId: string;
  readonly actor?: ChatActor;
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
    message: createInteractionMessageRef(args),
    command: args.command,
  };
}

export function createDiscordUnknownCommandEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly interactionId: string;
  readonly actor?: ChatActor;
  readonly commandName: string;
}): ChatAdapterUnknownCommandEvent<TChatId> {
  return {
    type: "command.unknown",
    chatId: args.chatId,
    conversation: { chatId: args.chatId, conversationId: args.conversationId },
    actor: args.actor,
    message: createInteractionMessageRef(args),
    commandName: args.commandName,
  };
}

export function createDiscordInvalidCommandEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly interactionId: string;
  readonly actor?: ChatActor;
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
}): ChatAdapterInvalidCommandEvent<TChatId> {
  return {
    type: "command.invalid",
    chatId: args.chatId,
    conversation: { chatId: args.chatId, conversationId: args.conversationId },
    actor: args.actor,
    message: createInteractionMessageRef(args),
    commandName: args.commandName,
    reason: args.reason,
    optionName: args.optionName,
  };
}

function createInteractionMessageRef<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly interactionId: string;
}) {
  return {
    chatId: args.chatId,
    conversationId: args.conversationId,
    messageId: `discord-interaction:${args.interactionId}`,
  } as const;
}
