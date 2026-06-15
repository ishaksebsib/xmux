import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import {
  handleThinkingAction,
  handleThinkingCommand,
  type HandleThinkingActionInput,
} from "./handler";
import { formatThinkingCommandUsage } from "./response";

export function registerThinkingRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "thinking", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "thinking",
      { readonly level?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleThinkingCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeAction = ctx.chat.on("action", "thinking", (raw) => {
    const event = raw as HandleThinkingActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleThinkingAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["thinking"],
    usage: () => formatThinkingCommandUsage(),
  });

  return () => {
    unsubscribeCommand();
    unsubscribeAction();
    unsubscribeInvalid();
  };
}
