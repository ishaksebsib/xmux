import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleCancelCommand } from "./handler";
import { formatCancelCommandUsage } from "./response";

/** Registers chat routes owned by the `/cancel` feature. */
export function registerCancelRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "cancel", (raw) => {
    const event = raw as CommandEvent<Extract<keyof TChats, string>, "cancel">;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleCancelCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["cancel"],
    usage: formatCancelCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
