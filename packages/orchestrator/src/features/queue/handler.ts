import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { queueActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, respondToAction, updateActionMessage, type CommandEvent } from "../utils";
import { PromptQueueActorMismatchError } from "./errors";
import {
  drainNextQueuedPrompt,
  interruptAndSendPromptOffer,
  isQueueOfferRequester,
  parseQueueActionValue,
  parseQueueOfferId,
  runQueueCommand,
  type QueueCommandOptions,
} from "./service";
import {
  formatQueueActionUnavailableAction,
  formatQueueAddedAction,
  formatQueueCommandFailure,
  formatQueueCommandOutput,
  formatQueueInterruptedAction,
  formatQueueRemovedBackToOfferAction,
} from "./response";

export interface HandleQueueCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "queue", QueueCommandOptions>;
}

export interface HandleQueueActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof queueActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleQueueCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueCommandInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const result = await runQueueCommand({ ctx: input.ctx, event: input.event });

  const replied = await replyWithResult({
    event: input.event,
    command: "queue",
    result,
    ok: formatQueueCommandOutput,
    err: formatQueueCommandFailure,
  });
  if (replied.isErr()) return replied;

  if (result.isOk() && result.value.status === "added") {
    return Result.mapError(
      await drainNextQueuedPrompt({ ctx: input.ctx, sessionRef: result.value.item.sessionRef }),
      (cause) => new CommandResponseError({ command: "queue", cause }),
    );
  }

  return Result.ok();
}

export async function handleQueueAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "queue",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const action = parseQueueActionValue(input.event.value);
  if (action.isErr()) {
    return updateActionMessage({
      command: "queue",
      event: input.event,
      message: formatQueueActionUnavailableAction(action.error),
    });
  }

  switch (action.value) {
    case "add":
      return addOfferToQueue(input);
    case "remove":
      return removeOfferFromQueue(input);
    case "interrupt":
      return interruptOfferAndSend(input);
  }
}

async function addOfferToQueue<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const offerId = parseQueueOfferId(input.event.payload);
  if (offerId.isErr()) return updateQueueActionUnavailable(input, offerId.error);

  const offer = input.ctx.app.services.promptQueue.getOffer(offerId.value);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateQueueActionUnavailable(
      input,
      new PromptQueueActorMismatchError({ offerId: offerId.value }),
    );
  }

  const enqueued = input.ctx.app.services.promptQueue.enqueueOffer(
    offerId.value,
    input.ctx.app.services.now().toISOString(),
  );

  const updated = await updateActionMessage({
    command: "queue",
    event: input.event,
    message: enqueued.isOk()
      ? formatQueueAddedAction(enqueued.value)
      : formatQueueActionUnavailableAction(enqueued.error),
  });
  if (updated.isErr() || enqueued.isErr()) return updated;

  return Result.mapError(
    await drainNextQueuedPrompt({ ctx: input.ctx, sessionRef: enqueued.value.item.sessionRef }),
    (cause) => new CommandResponseError({ command: "queue", cause }),
  );
}

async function removeOfferFromQueue<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const offerId = parseQueueOfferId(input.event.payload);
  if (offerId.isErr()) return updateQueueActionUnavailable(input, offerId.error);

  const offer = input.ctx.app.services.promptQueue.getOffer(offerId.value);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateQueueActionUnavailable(
      input,
      new PromptQueueActorMismatchError({ offerId: offerId.value }),
    );
  }

  const removed = input.ctx.app.services.promptQueue.removeQueuedOffer(
    offerId.value,
    input.ctx.app.services.now().toISOString(),
  );

  return updateActionMessage({
    command: "queue",
    event: input.event,
    message: removed.isOk()
      ? formatQueueRemovedBackToOfferAction(removed.value)
      : formatQueueActionUnavailableAction(removed.error),
  });
}

async function interruptOfferAndSend<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const offerId = parseQueueOfferId(input.event.payload);
  if (offerId.isErr()) return updateQueueActionUnavailable(input, offerId.error);

  const offer = input.ctx.app.services.promptQueue.getOffer(offerId.value);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateQueueActionUnavailable(
      input,
      new PromptQueueActorMismatchError({ offerId: offerId.value }),
    );
  }

  const sent = await interruptAndSendPromptOffer({ ctx: input.ctx, offerId: offerId.value });

  return updateActionMessage({
    command: "queue",
    event: input.event,
    message: sent.isOk()
      ? formatQueueInterruptedAction()
      : formatQueueActionUnavailableAction(sent.error),
  });
}

function updateQueueActionUnavailable<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
  error: unknown,
): Promise<ResultType<void, CommandResponseError>> {
  return updateActionMessage({
    command: "queue",
    event: input.event,
    message: formatQueueActionUnavailableAction(error),
  });
}
