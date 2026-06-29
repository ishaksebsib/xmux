import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleModelAction, handleModelCommand, type HandleModelActionInput } from "./handler";
import { registerModelMenu } from "./menu";
import { formatModelCommandUsage } from "./response";

export function registerModelRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeMenu = registerModelMenu(ctx);
  const unsubscribeCommand = ctx.chat.on("command", "model", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "model",
      { readonly selector?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleModelCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeAction = ctx.chat.on("action", "model", (raw) => {
    const event = raw as HandleModelActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleModelAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["model"],
    usage: () => formatModelCommandUsage(),
  });

  return () => {
    unsubscribeMenu();
    unsubscribeCommand();
    unsubscribeAction();
    unsubscribeInvalid();
  };
}
