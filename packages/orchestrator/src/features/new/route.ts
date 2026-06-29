import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { newHarnessActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import {
  handleNewCommand,
  handleNewHarnessAction,
  type HandleNewHarnessActionInput,
} from "./handler";
import { registerNewMenu } from "./menu";
import { formatNewCommandUsage } from "./response";

export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeMenu = registerNewMenu(ctx);
  const unsubscribeCommand = ctx.chat.on("command", "new", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "new",
      { readonly harnessId?: string; readonly title?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleNewCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeHarnessAction = ctx.chat.on("action", newHarnessActionId, (raw) => {
    const event = raw as HandleNewHarnessActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleNewHarnessAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["new"],
    usage: formatNewCommandUsage,
  });

  return () => {
    unsubscribeMenu();
    unsubscribeCommand();
    unsubscribeHarnessAction();
    unsubscribeInvalid();
  };
}
