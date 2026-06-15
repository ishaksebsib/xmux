import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../../ctx";
import type { XmuxMiddleware } from "../../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../../routing";
import type { CommandEvent } from "../../utils";
import { handleLsCommand } from "./handler";
import { formatLsCommandUsage } from "./response";

export function registerLsRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "ls", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "ls",
      { readonly path?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleLsCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["ls"],
    usage: formatLsCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
