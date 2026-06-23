import type {
  ChatActor,
  ChatAdapterDefinitions,
  ChatTextInput,
  Unsubscribe,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { Context, HandlerContext } from "../ctx";
import { runXmuxHandler, type XmuxMiddleware, type XmuxRoutedChatEvent } from "../middleware";
import { CommandResponseError } from "./errors";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "./utils";

type ChatIds<TChats> = Extract<keyof TChats, string>;

export interface DispatchInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TEvent extends XmuxRoutedChatEvent<ChatIds<TChats>>,
  TError,
> {
  readonly event: TEvent;
  readonly actor: ChatActor | undefined;
  readonly routeName?: string;
  readonly handler: (
    handlerCtx: HandlerContext<TAdapters, TChats, TEvent["chatId"]>,
  ) => Promise<Result<unknown, TError>>;
}

/**
 * Runs one routed chat event through xmux middleware and the route handler.
 *
 * Centralizes the per-route boilerplate: deriving the actor and invoking
 * `runXmuxHandler`, which owns route diagnostics and typed execution errors.
 */
export async function dispatch<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TEvent extends XmuxRoutedChatEvent<ChatIds<TChats>>,
  TError,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[],
  input: DispatchInput<TAdapters, TChats, TEvent, TError>,
): Promise<void> {
  await runXmuxHandler({
    app: ctx,
    event: input.event,
    middleware,
    ...(input.routeName === undefined ? {} : { routeName: input.routeName }),
    actor: actorFromChatActor(input.actor),
    handler: input.handler,
  });
}

/**
 * Subscribes to `"command.invalid"` and replies with usage for the named
 * commands. Shared by every command feature so usage replies stay uniform.
 */
export function registerInvalidCommandRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[],
  spec: {
    readonly commands: readonly string[];
    readonly usage: (commandName: string) => ChatTextInput;
  },
): Unsubscribe {
  return ctx.chat.on("command.invalid", (event) => {
    if (!spec.commands.includes(event.commandName)) {
      return;
    }

    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: () =>
        replyToInvalidCommandUsage({
          event: event as InvalidCommandEvent,
          commandName: event.commandName,
          usage: spec.usage(event.commandName),
          onError: (cause) => new CommandResponseError({ command: event.commandName, cause }),
        }),
    });
  });
}
