import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleDeleteCommand } from "./handler";
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

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["delete"],
    usage: formatDeleteCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
