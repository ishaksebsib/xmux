import type {
  ChatActor,
  ChatAdapterDefinitions,
  ChatAdapterObject,
  ChatInjectMessageInput,
  ChatSendActionInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { Actions } from "../../actions";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { cancelActivePromptForThread, type CancelActivePromptError } from "../cancel";
import { getActiveSessionForThread, type ActiveSessionError } from "../session";
import { threadFromChatEvent, type CommandEvent } from "../utils";
import type { PromptBusyEvent, PromptSettledEvent } from "../prompt/events";
import {
  PromptQueueFullError,
  PromptQueueInjectError,
  PromptQueueInvalidCommandError,
  PromptQueueItemNotFoundError,
  PromptQueueMissingActorError,
  PromptQueueOfferNotFoundError,
  PromptQueueResponseError,
} from "./errors";
import type {
  PromptQueueItemInput,
  PromptQueuePosition,
  PromptQueueRemoveOutput,
  QueuedPrompt,
} from "./registry";
import { formatQueueOfferAction } from "./response";

export type QueueCommandAction = "list" | "add" | "remove";

export type QueueCommandOutput =
  | {
      readonly status: "list";
      readonly session: SessionRecord;
      readonly items: readonly QueuedPrompt[];
    }
  | ({ readonly status: "added" } & PromptQueuePosition)
  | ({ readonly status: "removed" } & PromptQueueRemoveOutput);

export type AddPromptToQueueError =
  | ActiveSessionError
  | PromptQueueFullError
  | PromptQueueInvalidCommandError
  | PromptQueueMissingActorError;

export type QueueCommandError =
  | ActiveSessionError
  | PromptQueueFullError
  | PromptQueueInvalidCommandError
  | PromptQueueItemNotFoundError
  | PromptQueueMissingActorError;

export type RemovePromptFromQueueError =
  | ActiveSessionError
  | PromptQueueInvalidCommandError
  | PromptQueueItemNotFoundError;

export interface QueueCommandOptions {
  readonly action?: QueueCommandAction;
  readonly value?: string;
}

export async function offerPromptQueueChoice<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptBusyEvent<TAdapters, TChats>): Promise<ResultType<void, PromptQueueResponseError>> {
  const now = event.ctx.app.services.now().toISOString();
  event.ctx.app.services.promptQueue.pruneExpired(now);

  const offer = event.ctx.app.services.promptQueue.createOffer({
    item: promptItemInputFromBusyEvent(event),
    activeSince: event.error.activeSince,
    now,
  });

  const sent = await event.ctx.app.chat.sendAction({
    chatId: event.event.chatId,
    conversationId: event.event.conversation.conversationId,
    messageId: event.event.message.messageId,
    ...formatQueueOfferAction(offer),
    signal: event.ctx.signal,
  } as ChatSendActionInput<TChats, Actions>);

  return Result.map(
    Result.mapError(sent, (cause) => new PromptQueueResponseError({ operation: "offer", cause })),
    () => undefined,
  );
}

export async function drainQueuedPromptAfterPromptSettled<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptSettledEvent<TAdapters, TChats>): Promise<ResultType<void, PromptQueueInjectError>> {
  return drainNextQueuedPrompt({ ctx: event.ctx, sessionRef: event.session.ref });
}

export async function drainNextQueuedPrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly sessionRef: SessionRef;
}): Promise<ResultType<void, PromptQueueInjectError>> {
  const queue = input.ctx.app.services.promptQueue;
  if (queue.consumeSuppressNextDrain(input.sessionRef)) return Result.ok();
  if (input.ctx.app.services.promptRuns.get(input.sessionRef) !== undefined) return Result.ok();

  const now = input.ctx.app.services.now().toISOString();
  const item = queue.dequeueNext(input.sessionRef, now);
  if (item === undefined) return Result.ok();

  const injected = await injectQueuedPrompt({ ctx: input.ctx, item });
  if (injected.isErr()) {
    queue.requeueFront(item, input.ctx.app.services.now().toISOString());
  }

  return injected;
}

export async function runQueueCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "queue", QueueCommandOptions>;
}): Promise<ResultType<QueueCommandOutput, QueueCommandError>> {
  switch (input.event.command.options.action ?? "list") {
    case "list":
      return listQueuedPromptsForThread({
        ctx: input.ctx,
        thread: threadFromChatEvent(input.event),
      });
    case "add":
      return addPromptToQueueForThread({
        ctx: input.ctx,
        event: input.event,
        thread: threadFromChatEvent(input.event),
        text: input.event.command.options.value,
      });
    case "remove":
      return removePromptFromQueueForThread({
        ctx: input.ctx,
        thread: threadFromChatEvent(input.event),
        index: input.event.command.options.value,
      });
  }
}

export async function listQueuedPromptsForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}): Promise<ResultType<QueueCommandOutput, ActiveSessionError>> {
  const session = await getActiveSessionForThread(input.ctx, input.thread);
  if (session.isErr()) return Result.err(session.error);

  return Result.ok({
    status: "list",
    session: session.value,
    items: input.ctx.app.services.promptQueue.list(session.value.ref),
  });
}

export async function addPromptToQueueForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "queue", QueueCommandOptions>;
  readonly thread: ChatThreadRef;
  readonly text: string | undefined;
}): Promise<ResultType<QueueCommandOutput, AddPromptToQueueError>> {
  return Result.gen(async function* () {
    const text = yield* requirePromptText(input.text);
    const actor = yield* requireUserActor(input.event.actor, "add");
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const position = yield* input.ctx.app.services.promptQueue.enqueue(
      {
        sessionRef: session.ref,
        thread: input.thread,
        conversation: input.event.conversation,
        text,
        attachments: [],
        actor,
        adapterData: actor.adapterData,
        ...(input.ctx.actor === undefined ? {} : { requester: input.ctx.actor }),
        source: "command",
      },
      input.ctx.app.services.now().toISOString(),
    );

    return Result.ok({ status: "added" as const, ...position });
  });
}

export async function removePromptFromQueueForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly index: string | undefined;
}): Promise<ResultType<QueueCommandOutput, RemovePromptFromQueueError>> {
  return Result.gen(async function* () {
    const index = yield* parseQueueIndex(input.index);
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const removed = yield* input.ctx.app.services.promptQueue.removeByIndex(
      session.ref,
      index,
      input.ctx.app.services.now().toISOString(),
    );

    return Result.ok({ status: "removed" as const, ...removed });
  });
}

export async function interruptAndSendPromptOffer<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly offerId: string;
}): Promise<
  ResultType<
    void,
    | PromptQueueMissingActorError
    | PromptQueueInjectError
    | PromptQueueOfferNotFoundError
    | CancelActivePromptError
  >
> {
  const offer = input.ctx.app.services.promptQueue.getOffer(input.offerId);
  if (offer === undefined) {
    return Result.err(new PromptQueueOfferNotFoundError({ offerId: input.offerId }));
  }

  const actor = requireUserActor(offer.item.actor, "interrupt");
  if (actor.isErr()) return Result.err(actor.error);

  input.ctx.app.services.promptQueue.suppressNextDrain(offer.item.sessionRef);

  const cancelled = await cancelActivePromptForThread({
    ctx: input.ctx,
    thread: offer.item.thread,
  });
  if (cancelled.isErr()) {
    input.ctx.app.services.promptQueue.clearSuppressNextDrain(offer.item.sessionRef);
    return Result.err(cancelled.error);
  }

  if (offer.state === "queued") {
    input.ctx.app.services.promptQueue.removeQueuedOffer(
      offer.offerId,
      input.ctx.app.services.now().toISOString(),
    );
  }

  const injected = await injectQueuedPrompt({ ctx: input.ctx, item: offer.item });
  if (injected.isErr()) {
    input.ctx.app.services.promptQueue.clearSuppressNextDrain(offer.item.sessionRef);
    return injected;
  }
  if (cancelled.value.status !== "cancelled") {
    input.ctx.app.services.promptQueue.clearSuppressNextDrain(offer.item.sessionRef);
  }

  input.ctx.app.services.promptQueue.deleteOffer(offer.offerId);
  return Result.ok();
}

export function isQueueOfferRequester(input: {
  readonly actorUserId: string | undefined;
  readonly requesterUserId: string | undefined;
}): boolean {
  return input.requesterUserId === undefined || input.actorUserId === input.requesterUserId;
}

export function promptItemInputFromBusyEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptBusyEvent<TAdapters, TChats>): PromptQueueItemInput {
  return {
    sessionRef: event.error.sessionRef,
    thread: event.thread,
    conversation: event.event.conversation,
    text: event.event.message.text,
    attachments: event.event.message.attachments,
    actor: event.event.message.actor,
    adapterData: event.event.message.adapterData,
    ...(event.ctx.actor === undefined ? {} : { requester: event.ctx.actor }),
    source: "busy_prompt",
  };
}

export async function injectQueuedPrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly item: QueuedPrompt;
}): Promise<ResultType<void, PromptQueueInjectError>> {
  const injected = await input.ctx.app.chat.injectMessage(
    createQueueInjectMessageInput<TChats>(input.item),
  );

  return Result.map(
    Result.mapError(
      injected,
      (cause) => new PromptQueueInjectError({ itemId: input.item.itemId, cause }),
    ),
    () => undefined,
  );
}

function createQueueInjectMessageInput<TChats extends ChatAdapterDefinitions<TChats>>(
  item: QueuedPrompt,
): ChatInjectMessageInput<TChats> {
  return {
    chatId: item.conversation.chatId,
    conversationId: item.conversation.conversationId,
    messageId: item.message.messageId,
    actor: item.actor,
    text: item.text,
    format: "plain",
    attachments: item.attachments,
    adapterData: item.adapterData,
  } as ChatInjectMessageInput<TChats>;
}

function requirePromptText(
  text: string | undefined,
): ResultType<string, PromptQueueInvalidCommandError> {
  const trimmed = text?.trim() ?? "";
  return trimmed.length === 0
    ? Result.err(new PromptQueueInvalidCommandError({ reason: "Usage: /queue add <prompt>" }))
    : Result.ok(trimmed);
}

function parseQueueIndex(
  value: string | undefined,
): ResultType<number, PromptQueueInvalidCommandError> {
  const trimmed = value?.trim() ?? "";
  const index = Number(trimmed);
  return Number.isInteger(index) && index > 0
    ? Result.ok(index)
    : Result.err(new PromptQueueInvalidCommandError({ reason: "Usage: /queue remove <position>" }));
}

function requireUserActor<TAdapterData extends ChatAdapterObject>(
  actor: ChatActor<TAdapterData> | undefined,
  operation: "add" | "interrupt",
): ResultType<ChatActor<TAdapterData>, PromptQueueMissingActorError> {
  return actor?.kind === "user"
    ? Result.ok(actor)
    : Result.err(new PromptQueueMissingActorError({ operation }));
}
