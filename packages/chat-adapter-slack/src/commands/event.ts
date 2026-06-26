import type {
  ChatActor,
  ChatAdapterCommandEvent,
  ChatAdapterInvalidCommandEvent,
  ChatAdapterMessageEvent,
  ChatAdapterUnknownCommandEvent,
  ChatCommandRegistry,
  ChatCommandValues,
  ChatMessageRef,
} from "@xmux/chat-core";
import type { SlackCommandEvent } from "../client";
import { createSlackConversationId } from "../conversation";
import type { SlackAdapterData, SlackConversationScope } from "../types";
import { isRecord, nonEmpty } from "../utils";

export function createSlackCommandEvent<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
  readonly conversationScope?: SlackConversationScope;
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
  readonly conversationScope?: SlackConversationScope;
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

export function createSlackMentionCommandEvent<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly source: ChatAdapterMessageEvent<TChatId, SlackAdapterData>;
  readonly command: ChatCommandValues<TCommands>;
}): ChatAdapterCommandEvent<TCommands, keyof TCommands, TChatId> {
  return {
    type: "command",
    chatId: args.source.chatId,
    conversation: args.source.conversation,
    actor: args.source.message.actor,
    message: createSourceMessageRef(args.source),
    command: args.command,
  };
}

export function createSlackMentionUnknownCommandEvent<TChatId extends string>(args: {
  readonly source: ChatAdapterMessageEvent<TChatId, SlackAdapterData>;
  readonly commandName: string;
}): ChatAdapterUnknownCommandEvent<TChatId> {
  return {
    type: "command.unknown",
    chatId: args.source.chatId,
    conversation: args.source.conversation,
    actor: args.source.message.actor,
    message: createSourceMessageRef(args.source),
    commandName: args.commandName,
  };
}

export function createSlackInvalidCommandEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly payload: SlackCommandEvent["payload"];
  readonly conversationScope?: SlackConversationScope;
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

export function createSlackMentionInvalidCommandEvent<TChatId extends string>(args: {
  readonly source: ChatAdapterMessageEvent<TChatId, SlackAdapterData>;
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
}): ChatAdapterInvalidCommandEvent<TChatId> {
  return {
    type: "command.invalid",
    chatId: args.source.chatId,
    conversation: args.source.conversation,
    actor: args.source.message.actor,
    message: createSourceMessageRef(args.source),
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
  readonly conversationScope?: SlackConversationScope;
}) {
  return {
    chatId: args.chatId,
    conversationId: createSlackConversationId({
      conversationScope: args.conversationScope ?? "channel",
      channelId: args.payload.channel_id,
      threadTs: readSlackCommandThreadTs(args.payload),
    }),
  } as const;
}

function createSourceMessageRef<TChatId extends string>(
  source: ChatAdapterMessageEvent<TChatId, SlackAdapterData>,
): ChatMessageRef<TChatId> {
  return {
    chatId: source.chatId,
    conversationId: source.conversation.conversationId,
    messageId: source.message.messageId,
  };
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

function readSlackCommandThreadTs(payload: SlackCommandEvent["payload"]): string | undefined {
  if (!isRecord(payload)) return undefined;

  const threadTs = payload["thread_ts"];
  return typeof threadTs === "string" ? threadTs : undefined;
}
