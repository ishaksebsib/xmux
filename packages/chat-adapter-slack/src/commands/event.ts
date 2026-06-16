import type {
  ChatActor,
  ChatAdapterCommandEvent,
  ChatAdapterInvalidCommandEvent,
  ChatAdapterUnknownCommandEvent,
  ChatCommandRegistry,
  ChatCommandValues,
} from "@xmux/chat-core";
import type { SlackCommandEvent } from "../client";
import type { SlackAdapterData } from "../types";

export function createSlackCommandEvent<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
  readonly command: ChatCommandValues<TCommands>;
}): ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId> {
  return {
    type: "command",
    chatId: args.chatId,
    conversation: createConversation(args),
    actor: createSlackCommandActor(args.payload),
    command: args.command,
  };
}

export function createSlackUnknownCommandEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
  readonly commandName: string;
}): ChatAdapterUnknownCommandEvent<TChatId> {
  return {
    type: "command.unknown",
    chatId: args.chatId,
    conversation: createConversation(args),
    actor: createSlackCommandActor(args.payload),
    commandName: args.commandName,
  };
}

export function createSlackInvalidCommandEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
}): ChatAdapterInvalidCommandEvent<TChatId> {
  return {
    type: "command.invalid",
    chatId: args.chatId,
    conversation: createConversation(args),
    actor: createSlackCommandActor(args.payload),
    commandName: args.commandName,
    reason: args.reason,
    optionName: args.optionName,
  };
}

export function createSlackCommandActor(payload: SlackCommandEvent["payload"]): ChatActor {
  const displayName = nonEmpty(payload.user_name);

  return {
    kind: "user",
    actorId: payload.user_id,
    ...(displayName === undefined ? {} : { displayName }),
    adapterData: createSlackCommandAdapterData(payload),
  } satisfies ChatActor<SlackAdapterData>;
}

function createConversation<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
}) {
  return {
    chatId: args.chatId,
    conversationId: args.payload.channel_id,
  } as const;
}

function createSlackCommandAdapterData(payload: SlackCommandEvent["payload"]): SlackAdapterData {
  return {
    slackTeamId: nonEmpty(payload.team_id),
    slackEnterpriseId: nonEmpty(payload.enterprise_id),
    slackChannelId: payload.channel_id,
    slackUserId: payload.user_id,
    raw: payload,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
