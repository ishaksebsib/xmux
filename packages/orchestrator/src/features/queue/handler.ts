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

  return replyWithResult({
    event: input.event,
    command: "queue",
    result,
    ok: formatQueueCommandOutput,
    err: formatQueueCommandFailure,
  });
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

  switch (input.event.value) {
    case "add":
      return addOfferToQueue(input);
    case "remove":
      return removeOfferFromQueue(input);
    case "interrupt":
      return interruptOfferAndSend(input);
  }

  return Result.ok();
}

async function addOfferToQueue<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const offer = input.ctx.app.services.promptQueue.getOffer(input.event.payload);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateActionMessage({
      command: "queue",
      event: input.event,
      message: formatQueueActionUnavailableAction(
        new PromptQueueActorMismatchError({ offerId: input.event.payload }),
      ),
    });
  }

  const enqueued = input.ctx.app.services.promptQueue.enqueueOffer(
    input.event.payload,
    input.ctx.app.services.now().toISOString(),
  );

  const updated = await updateActionMessage({
    command: "queue",
    event: input.event,
    message: enqueued.isOk()
      ? formatQueueAddedAction(enqueued.value)
      : formatQueueActionUnavailableAction(enqueued.error),
  });

  if (updated.isOk() && enqueued.isOk()) {
    await drainNextQueuedPrompt({ ctx: input.ctx, sessionRef: enqueued.value.item.sessionRef });
  }

  return updated;
}

async function removeOfferFromQueue<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleQueueActionInput<TAdapters, TChats>,
): Promise<ResultType<void, CommandResponseError>> {
  const offer = input.ctx.app.services.promptQueue.getOffer(input.event.payload);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateActionMessage({
      command: "queue",
      event: input.event,
      message: formatQueueActionUnavailableAction(
        new PromptQueueActorMismatchError({ offerId: input.event.payload }),
      ),
    });
  }

  const removed = input.ctx.app.services.promptQueue.removeQueuedOffer(
    input.event.payload,
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
  const offer = input.ctx.app.services.promptQueue.getOffer(input.event.payload);
  if (
    offer !== undefined &&
    !isQueueOfferRequester({
      actorUserId: input.ctx.actor?.userId,
      requesterUserId: offer.item.requester?.userId,
    })
  ) {
    return updateActionMessage({
      command: "queue",
      event: input.event,
      message: formatQueueActionUnavailableAction(
        new PromptQueueActorMismatchError({ offerId: input.event.payload }),
      ),
    });
  }

  const sent = await interruptAndSendPromptOffer({ ctx: input.ctx, offerId: input.event.payload });

  return updateActionMessage({
    command: "queue",
    event: input.event,
    message: sent.isOk()
      ? formatQueueInterruptedAction()
      : formatQueueActionUnavailableAction(sent.error),
  });
}
