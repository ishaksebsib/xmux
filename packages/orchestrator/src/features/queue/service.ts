import type {
  ChatActor,
  ChatAdapterDefinitions,
  ChatAdapterObject,
  ChatInjectMessageInputFor,
  ChatMessageRef,
  ChatSendActionInputFor,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { xmuxLogEvents } from "../../logger";
import { serializeXmuxLogError } from "../../logger-utils";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { cancelActivePromptForThread, type CancelActivePromptError } from "../cancel";
import { NoActiveSessionError, SessionRecordMissingError } from "../errors";
import { getActiveSessionForThread, type ActiveSessionError } from "../session";
import { threadFromChatEvent, type CommandEvent } from "../utils";
import type {
  PromptBusyEvent,
  PromptRejectedEvent,
  PromptSettledEvent,
  PromptStartedEvent,
} from "../prompt/events";
import {
  PromptQueueActorMismatchError,
  PromptQueueDrainStateConflictError,
  PromptQueueFullError,
  PromptQueueInjectError,
  PromptQueueInvalidCommandError,
  PromptQueueItemNotFoundError,
  PromptQueueMissingActorError,
  PromptQueueOfferNotFoundError,
  PromptQueueOfferStateConflictError,
  PromptQueueResponseError,
} from "./errors";
import type {
  PromptQueueItemInput,
  PromptQueuePosition,
  PromptQueueRemoveOutput,
  QueuedPrompt,
} from "./registry";
import { formatQueueOfferAction } from "./response";
import { makeQueueIndex, makeQueueOfferId, type QueueIndex, type QueueOfferId } from "./primitives";

export type QueueCommandAction = "list" | "add" | "remove";
export type QueueActionValue = "add" | "interrupt" | "remove";

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
  | PromptQueueActorMismatchError
  | PromptQueueFullError
  | PromptQueueInvalidCommandError
  | PromptQueueItemNotFoundError
  | PromptQueueMissingActorError;

export type RemovePromptFromQueueError =
  | ActiveSessionError
  | PromptQueueActorMismatchError
  | PromptQueueInvalidCommandError
  | PromptQueueItemNotFoundError;

export type InterruptAndSendPromptOfferError =
  | PromptQueueDrainStateConflictError
  | PromptQueueFullError
  | PromptQueueInjectError
  | PromptQueueItemNotFoundError
  | PromptQueueMissingActorError
  | PromptQueueOfferNotFoundError
  | PromptQueueOfferStateConflictError
  | CancelActivePromptError;

export interface QueueCommandOptions {
  readonly action?: unknown;
  readonly value?: unknown;
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

  const sent = await event.ctx.app.chat.sendAction(
    createQueueOfferSendActionInput<TChats, typeof event.ctx.chatId>({
      chatId: event.ctx.chatId,
      conversationId: event.event.conversation.conversationId,
      messageId: event.event.message.messageId,
      message: formatQueueOfferAction(offer),
      signal: event.ctx.signal,
    }),
  );

  return Result.map(
    Result.mapError(sent, (cause) => new PromptQueueResponseError({ operation: "offer", cause })),
    () => undefined,
  );
}

export function markQueuedPromptStarted<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptStartedEvent<TAdapters, TChats>): Promise<ResultType<void, never>> {
  event.ctx.app.services.promptQueue.completeDrain(event.session.ref);
  return Promise.resolve(Result.ok());
}

export async function drainQueuedPromptAfterPromptSettled<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptSettledEvent<TAdapters, TChats>): Promise<ResultType<void, PromptQueueInjectError>> {
  const queue = event.ctx.app.services.promptQueue;
  if (queue.consumeSuppressedSettledRequest(event.session.ref, event.requestId)) return Result.ok();

  queue.completeDrain(event.session.ref);
  return drainNextQueuedPrompt({ ctx: event.ctx, sessionRef: event.session.ref });
}

export async function releaseQueuedPromptAfterPromptRejected<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  event: PromptRejectedEvent<TAdapters, TChats>,
): Promise<ResultType<void, PromptQueueInjectError>> {
  const queue = event.ctx.app.services.promptQueue;

  if (NoActiveSessionError.is(event.error) || SessionRecordMissingError.is(event.error)) {
    queue.clearThread(event.thread);
    return Result.ok();
  }

  const completed = queue.completeDrainForThread(event.thread);
  return completed.status === "completed"
    ? drainNextQueuedPrompt({ ctx: event.ctx, sessionRef: completed.sessionRef })
    : Result.ok();
}

export async function drainNextQueuedPrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly sessionRef: SessionRef;
}): Promise<ResultType<void, PromptQueueInjectError>> {
  const queue = input.ctx.app.services.promptQueue;
  if (input.ctx.app.services.promptRuns.get(input.sessionRef) !== undefined) return Result.ok();

  const started = queue.startDrain(input.sessionRef, input.ctx.app.services.now().toISOString());
  if (started.status !== "started") return Result.ok();

  const injected = await injectQueuedPrompt({ ctx: input.ctx, item: started.item });
  if (injected.isOk()) return Result.ok();

  const requeued = queue.failDrainAndRequeue(
    started.item,
    input.ctx.app.services.now().toISOString(),
  );
  if (requeued.isErr()) {
    logQueueBackgroundFailure({
      ctx: input.ctx,
      reason: "queued_prompt_requeue_failed",
      sessionRef: started.item.sessionRef,
      error: requeued.error,
    });
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
  const action = parseQueueCommandAction(input.event.command.options.action);
  if (action.isErr()) return Result.err(action.error);

  switch (action.value) {
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
  readonly text: unknown;
}): Promise<ResultType<QueueCommandOutput, AddPromptToQueueError>> {
  return Result.gen(async function* () {
    const text = yield* parsePromptText(input.text);
    const actor = yield* requireUserActor(input.event.actor, "add");
    const message = yield* requireSourceMessage(input.event.message);
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const position = yield* input.ctx.app.services.promptQueue.enqueue(
      {
        sessionRef: session.ref,
        thread: input.thread,
        conversation: input.event.conversation,
        message,
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
  readonly index: unknown;
}): Promise<ResultType<QueueCommandOutput, RemovePromptFromQueueError>> {
  return Result.gen(async function* () {
    const index = yield* parseQueueIndex(input.index);
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const position = input.ctx.app.services.promptQueue.itemAt(session.ref, index);
    if (position === undefined) {
      return Result.err(new PromptQueueItemNotFoundError({ sessionRef: session.ref, index }));
    }
    yield* requireQueueItemRequester({
      actorUserId: input.ctx.actor?.userId,
      item: position.item,
    });

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
  readonly offerId: QueueOfferId;
}): Promise<ResultType<void, InterruptAndSendPromptOfferError>> {
  const queue = input.ctx.app.services.promptQueue;
  const offer = queue.getOffer(input.offerId);
  if (offer === undefined)
    return Result.err(new PromptQueueOfferNotFoundError({ offerId: input.offerId }));

  const actor = requireUserActor(offer.item.actor, "interrupt");
  if (actor.isErr()) return Result.err(actor.error);

  const activeRequestId = input.ctx.app.services.promptRuns.get(offer.item.sessionRef)?.requestId;
  if (activeRequestId !== undefined) {
    queue.suppressSettledRequest(offer.item.sessionRef, activeRequestId);
  }

  const wasQueued = offer.state === "queued";
  if (wasQueued) {
    const removed = queue.removeQueuedOffer(
      offer.offerId,
      input.ctx.app.services.now().toISOString(),
    );
    if (removed.isErr()) {
      if (activeRequestId !== undefined) {
        queue.clearSuppressedSettledRequest(offer.item.sessionRef, activeRequestId);
      }
      return Result.err(removed.error);
    }
  }

  const injecting = queue.beginInjecting(offer.item);
  if (injecting.isErr()) {
    if (wasQueued) requeueFrontAfterInterruptFailure(input.ctx, offer.item);
    if (activeRequestId !== undefined) {
      queue.clearSuppressedSettledRequest(offer.item.sessionRef, activeRequestId);
    }
    return Result.err(injecting.error);
  }

  const cancelled = await cancelActivePromptForThread({
    ctx: input.ctx,
    thread: offer.item.thread,
  });
  if (cancelled.isErr()) {
    if (wasQueued) failDrainAndRequeueAfterInterruptFailure(input.ctx, offer.item);
    else queue.completeDrain(offer.item.sessionRef);
    if (activeRequestId !== undefined) {
      queue.clearSuppressedSettledRequest(offer.item.sessionRef, activeRequestId);
    }
    return Result.err(cancelled.error);
  }

  const injected = await injectQueuedPrompt({ ctx: input.ctx, item: offer.item });
  if (injected.isErr()) {
    if (wasQueued) failDrainAndRequeueAfterInterruptFailure(input.ctx, offer.item);
    else queue.completeDrain(offer.item.sessionRef);
    if (activeRequestId !== undefined) {
      queue.clearSuppressedSettledRequest(offer.item.sessionRef, activeRequestId);
    }
    return injected;
  }

  if (cancelled.value.status !== "cancelled" && activeRequestId !== undefined) {
    queue.clearSuppressedSettledRequest(offer.item.sessionRef, activeRequestId);
  }

  queue.deleteOffer(offer.offerId);
  return Result.ok();
}

export function isQueueOfferRequester(input: {
  readonly actorUserId: string | undefined;
  readonly requesterUserId: string | undefined;
}): boolean {
  return input.requesterUserId === undefined || input.actorUserId === input.requesterUserId;
}

export function parseQueueActionValue(
  input: unknown,
): ResultType<QueueActionValue, PromptQueueInvalidCommandError> {
  return input === "add" || input === "interrupt" || input === "remove"
    ? Result.ok(input)
    : Result.err(new PromptQueueInvalidCommandError({ reason: "Unknown queue action." }));
}

export function parseQueueOfferId(
  input: unknown,
): ResultType<QueueOfferId, PromptQueueInvalidCommandError> {
  return typeof input === "string" && input.trim().length > 0
    ? Result.ok(makeQueueOfferId(input))
    : Result.err(new PromptQueueInvalidCommandError({ reason: "Queue action expired." }));
}

export function parseQueueCommandAction(
  input: unknown,
): ResultType<QueueCommandAction, PromptQueueInvalidCommandError> {
  if (input === undefined) return Result.ok("list");
  return input === "list" || input === "add" || input === "remove"
    ? Result.ok(input)
    : Result.err(
        new PromptQueueInvalidCommandError({
          reason: "Usage: /queue [add <prompt>|remove <position>]",
        }),
      );
}

export function promptItemInputFromBusyEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: PromptBusyEvent<TAdapters, TChats>): PromptQueueItemInput {
  return {
    sessionRef: event.error.sessionRef,
    thread: event.thread,
    conversation: event.event.conversation,
    message: {
      chatId: event.event.message.chatId,
      conversationId: event.event.message.conversationId,
      messageId: event.event.message.messageId,
    },
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
    createQueueInjectMessageInput<TChats, Extract<keyof TChats, string>>(input.item),
  );

  return Result.map(
    Result.mapError(
      injected,
      (cause) => new PromptQueueInjectError({ itemId: input.item.itemId, cause }),
    ),
    () => undefined,
  );
}

function createQueueOfferSendActionInput<
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
>(input: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly message: ReturnType<typeof formatQueueOfferAction>;
  readonly signal: AbortSignal;
}): ChatSendActionInputFor<TChats, Actions, TChatId> {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    text: input.message.text,
    format: input.message.format,
    buttons: input.message.buttons,
    signal: input.signal,
  } as ChatSendActionInputFor<TChats, Actions, TChatId>;
}

function createQueueInjectMessageInput<
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
>(item: QueuedPrompt): ChatInjectMessageInputFor<TChats, TChatId> {
  return {
    chatId: item.conversation.chatId,
    conversationId: item.conversation.conversationId,
    messageId: item.message.messageId,
    actor: item.actor,
    text: item.text,
    format: "plain",
    attachments: item.attachments,
    adapterData: item.adapterData,
  } as ChatInjectMessageInputFor<TChats, TChatId>;
}

function parsePromptText(input: unknown): ResultType<string, PromptQueueInvalidCommandError> {
  const trimmed = typeof input === "string" ? input.trim() : "";
  return trimmed.length === 0
    ? Result.err(new PromptQueueInvalidCommandError({ reason: "Usage: /queue add <prompt>" }))
    : Result.ok(trimmed);
}

function parseQueueIndex(input: unknown): ResultType<QueueIndex, PromptQueueInvalidCommandError> {
  const value = typeof input === "string" || typeof input === "number" ? Number(input) : NaN;
  return Number.isInteger(value) && value > 0
    ? Result.ok(makeQueueIndex(value))
    : Result.err(new PromptQueueInvalidCommandError({ reason: "Usage: /queue remove <position>" }));
}

function requireSourceMessage<TChatId extends string>(
  message: ChatMessageRef<TChatId> | undefined,
): ResultType<ChatMessageRef<TChatId>, PromptQueueInvalidCommandError> {
  return message === undefined
    ? Result.err(
        new PromptQueueInvalidCommandError({
          reason: "This chat cannot replay /queue add because the command has no source message.",
        }),
      )
    : Result.ok(message);
}

function requireUserActor<TAdapterData extends ChatAdapterObject>(
  actor: ChatActor<TAdapterData> | undefined,
  operation: "add" | "interrupt",
): ResultType<ChatActor<TAdapterData>, PromptQueueMissingActorError> {
  return actor?.kind === "user"
    ? Result.ok(actor)
    : Result.err(new PromptQueueMissingActorError({ operation }));
}

function requireQueueItemRequester(input: {
  readonly actorUserId: string | undefined;
  readonly item: QueuedPrompt;
}): ResultType<void, PromptQueueActorMismatchError> {
  return isQueueOfferRequester({
    actorUserId: input.actorUserId,
    requesterUserId: input.item.requester?.userId,
  })
    ? Result.ok()
    : Result.err(new PromptQueueActorMismatchError({ offerId: input.item.itemId }));
}

function requeueFrontAfterInterruptFailure<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: HandlerContext<TAdapters, TChats>, item: QueuedPrompt): void {
  const requeued = ctx.app.services.promptQueue.requeueFront(
    item,
    ctx.app.services.now().toISOString(),
  );
  if (requeued.isErr()) {
    logQueueBackgroundFailure({
      ctx,
      reason: "interrupt_requeue_failed",
      sessionRef: item.sessionRef,
      error: requeued.error,
    });
  }
}

function failDrainAndRequeueAfterInterruptFailure<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: HandlerContext<TAdapters, TChats>, item: QueuedPrompt): void {
  const requeued = ctx.app.services.promptQueue.failDrainAndRequeue(
    item,
    ctx.app.services.now().toISOString(),
  );
  if (requeued.isErr()) {
    logQueueBackgroundFailure({
      ctx,
      reason: "interrupt_requeue_failed",
      sessionRef: item.sessionRef,
      error: requeued.error,
    });
  }
}

function logQueueBackgroundFailure<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly reason: string;
  readonly sessionRef: SessionRef;
  readonly error: unknown;
}): void {
  input.ctx.logger.warn(xmuxLogEvents.backgroundFailure, {
    operation: "queue",
    result: "error",
    reason: input.reason,
    harnessId: input.sessionRef.harnessId,
    sessionId: input.sessionRef.sessionId,
    error: serializeXmuxLogError(input.error),
  });
}
