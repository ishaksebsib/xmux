import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { queueActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleQueueAction, handleQueueCommand, type HandleQueueActionInput } from "./handler";
import { registerQueueMenu } from "./menu";
import { formatQueueCommandUsage } from "./response";
import {
  drainQueuedPromptAfterPromptSettled,
  markQueuedPromptStarted,
  offerPromptQueueChoice,
  releaseQueuedPromptAfterPromptRejected,
} from "./service";

/** Registers chat routes and prompt lifecycle hooks owned by the queue feature. */
export function registerQueueRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeMenu = registerQueueMenu(ctx);
  const unsubscribeCommand = ctx.chat.on("command", "queue", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "queue",
      { readonly action?: unknown; readonly value?: unknown }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleQueueCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeAction = ctx.chat.on("action", queueActionId, (raw) => {
    const event = raw as HandleQueueActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      routeName: "queue",
      handler: (handlerCtx) => handleQueueAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeBusy = ctx.services.promptEvents.on("prompt.busy", offerPromptQueueChoice);
  const unsubscribeStarted = ctx.services.promptEvents.on(
    "prompt.started",
    markQueuedPromptStarted,
  );
  const unsubscribeRejected = ctx.services.promptEvents.on(
    "prompt.rejected",
    releaseQueuedPromptAfterPromptRejected,
  );
  const unsubscribeSettled = ctx.services.promptEvents.on(
    "prompt.settled",
    drainQueuedPromptAfterPromptSettled,
  );

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["queue"],
    usage: () => formatQueueCommandUsage(),
  });

  return () => {
    unsubscribeMenu();
    unsubscribeCommand();
    unsubscribeAction();
    unsubscribeBusy();
    unsubscribeStarted();
    unsubscribeRejected();
    unsubscribeSettled();
    unsubscribeInvalid();
  };
}
