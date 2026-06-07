import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleNewCommand } from "./handler";
import { formatNewCommandUsage } from "./response";

export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "new", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "new",
      { readonly harnessId: string; readonly title?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleNewCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["new"],
    usage: formatNewCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
