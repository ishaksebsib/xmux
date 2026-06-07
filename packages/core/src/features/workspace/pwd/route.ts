import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../../ctx";
import type { XmuxMiddleware } from "../../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../../routing";
import type { CommandEvent } from "../../utils";
import { handlePwdCommand } from "./handler";
import { formatPwdCommandUsage } from "./response";

export function registerPwdRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "pwd", (raw) => {
    const event = raw as CommandEvent<Extract<keyof TChats, string>, "pwd">;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handlePwdCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["pwd"],
    usage: formatPwdCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeInvalid();
  };
}
