import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { menuActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleMenuAction, handleMenuCommand, type HandleMenuActionInput } from "./handler";
import { formatMenuCommandUsage } from "./response";

export function registerMenuRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "menu", (raw) => {
    const event = raw as CommandEvent<Extract<keyof TChats, string>, "menu">;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleMenuCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeAction = ctx.chat.on("action", menuActionId, (raw) => {
    const event = raw as HandleMenuActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      routeName: "menu",
      handler: (handlerCtx) => handleMenuAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["menu"],
    usage: () => formatMenuCommandUsage(),
  });

  return () => {
    unsubscribeCommand();
    unsubscribeAction();
    unsubscribeInvalid();
  };
}
