import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { deleteHarnessActionId, deleteSessionActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import {
  handleDeleteCommand,
  handleDeleteHarnessAction,
  handleDeleteSessionAction,
  type HandleDeleteHarnessActionInput,
  type HandleDeleteSessionActionInput,
} from "./handler";
import { formatDeleteCommandUsage } from "./response";

export function registerDeleteRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "delete", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "delete",
      { readonly harnessId?: string; readonly shortId?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleDeleteCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeHarnessAction = ctx.chat.on("action", deleteHarnessActionId, (raw) => {
    const event = raw as HandleDeleteHarnessActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleDeleteHarnessAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeSessionAction = ctx.chat.on("action", deleteSessionActionId, (raw) => {
    const event = raw as HandleDeleteSessionActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleDeleteSessionAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["delete"],
    usage: formatDeleteCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeHarnessAction();
    unsubscribeSessionAction();
    unsubscribeInvalid();
  };
}
