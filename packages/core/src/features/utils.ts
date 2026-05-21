import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actor } from "../ctx";
import type { ChatThreadRef } from "../store";

export interface ChatEventWithConversation<TChatId extends string = string> {
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
}

export interface ChatEventWithReply {
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

export interface InvalidCommandEvent extends ChatEventWithReply {
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
}

export type InvalidCommandUsageReplyStatus = "ignored" | "replied";

export function threadFromChatEvent<TChatId extends string>(
  event: ChatEventWithConversation<TChatId>,
): ChatThreadRef<TChatId> {
  return {
    chatId: event.chatId,
    threadId: event.conversation.conversationId,
  };
}

export function actorFromChatActor(actor: ChatActor | undefined): Actor | undefined {
  if (!actor) {
    return undefined;
  }

  return {
    userId: actor.actorId ?? "system",
    ...(actor.displayName === undefined ? {} : { displayName: actor.displayName }),
  };
}

export function requireConfiguredHarnessId<THarnessId extends string, TError>(input: {
  readonly harnessId: string;
  readonly availableHarnessIds: readonly THarnessId[];
  readonly onMissing: (args: {
    readonly harnessId: string;
    readonly availableHarnessIds: readonly THarnessId[];
  }) => TError;
}): BetterResult<THarnessId, TError> {
  return input.availableHarnessIds.includes(input.harnessId as THarnessId)
    ? Result.ok(input.harnessId as THarnessId)
    : Result.err(
        input.onMissing({
          harnessId: input.harnessId,
          availableHarnessIds: input.availableHarnessIds,
        }),
      );
}

export async function replyToChatEvent<TError>(input: {
  readonly event: ChatEventWithReply;
  readonly message: string;
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<void, TError>> {
  const replied = await Result.tryPromise({
    try: () => input.event.reply(input.message),
    catch: input.onError,
  });

  if (replied.isErr()) {
    return Result.err(replied.error);
  }

  if (replied.value.isErr()) {
    return Result.err(input.onError(replied.value.error));
  }

  return Result.ok();
}

export async function replyToInvalidCommandUsage<TError>(input: {
  readonly event: InvalidCommandEvent;
  readonly commandName: string;
  readonly usage: string;
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<InvalidCommandUsageReplyStatus, TError>> {
  if (input.event.commandName !== input.commandName) {
    return Result.ok("ignored");
  }

  const replied = await replyToChatEvent({
    event: input.event,
    message: input.usage,
    onError: input.onError,
  });

  if (replied.isErr()) {
    return Result.err(replied.error);
  }

  return Result.ok("replied");
}
