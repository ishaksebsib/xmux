import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../../ctx";
import type { XmuxMiddleware } from "../../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../../routing";
import type { CommandEvent } from "../../utils";
import { handleCdCommand } from "./handler";
import { formatCdCommandUsage } from "./response";

export function registerCdRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "cd", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "cd",
      { readonly path: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleCdCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["cd"],
    usage: formatCdCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
