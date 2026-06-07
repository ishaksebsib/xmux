import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleExitCommand } from "./handler";
import { formatExitCommandUsage } from "./response";

export function registerExitRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "exit", (raw) => {
    const event = raw as CommandEvent<Extract<keyof TChats, string>, "exit">;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleExitCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["exit"],
    usage: formatExitCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
