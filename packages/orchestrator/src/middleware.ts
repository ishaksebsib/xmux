import type { ChatAdapterDefinitions, ChatConversationRef, ChatEventType } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { createHandlerContext, type Actor, type Context, type HandlerContext } from "./ctx";
import { XmuxMiddlewareExecutionError, XmuxMiddlewareNextAlreadyCalledError } from "./errors";
import { xmuxLogEvents, type XmuxLogMetadata } from "./logger";
import { logXmuxResult, runWithXmuxLogContext, startXmuxLogTimer } from "./logger-utils";

/** Chat event shape routed through xmux request middleware. */
export interface XmuxRoutedChatEvent<TChatId extends string = string> {
  readonly type: ChatEventType;
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
}

/** Request route metadata derived from the concrete chat event being handled. */
export interface XmuxRouteDescriptor<TEvent extends XmuxRoutedChatEvent = XmuxRoutedChatEvent> {
  readonly name: string;
  readonly eventType: TEvent["type"];
}

/** Request-scoped data visible to xmux middleware. */
export interface XmuxMiddlewareContext<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TEvent extends XmuxRoutedChatEvent<Extract<keyof TChats, string>> = XmuxRoutedChatEvent<
    Extract<keyof TChats, string>
  >,
> {
  readonly app: Context<TAdapters, TChats>;
  readonly handler: HandlerContext<TAdapters, TChats, TEvent["chatId"]>;
  readonly event: TEvent;
  readonly route: XmuxRouteDescriptor<TEvent>;
}

export type XmuxMiddlewareNext = () => Promise<Result<void, unknown>>;

export type XmuxMiddleware<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> = (
  ctx: XmuxMiddlewareContext<TAdapters, TChats>,
  next: XmuxMiddlewareNext,
) => Promise<Result<void, unknown>>;

export interface RunXmuxHandlerInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TEvent extends XmuxRoutedChatEvent<Extract<keyof TChats, string>>,
  TError,
> {
  readonly app: Context<TAdapters, TChats>;
  readonly event: TEvent;
  readonly middleware: readonly XmuxMiddleware<TAdapters, TChats>[];
  readonly routeName?: string;
  readonly actor?: Actor;
  readonly handler: (
    ctx: HandlerContext<TAdapters, TChats, TEvent["chatId"]>,
  ) => Promise<Result<unknown, TError>>;
}

/** Runs one routed chat handler through xmux middleware using Koa-style composition. */
export async function runXmuxHandler<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TEvent extends XmuxRoutedChatEvent<Extract<keyof TChats, string>>,
  TError,
>(input: RunXmuxHandlerInput<TAdapters, TChats, TEvent, TError>): Promise<Result<void, unknown>> {
  const routeName = input.routeName ?? defaultRouteName(input.event);
  const baseHandler = createHandlerContext({
    app: input.app,
    chatId: input.event.chatId,
    actor: input.actor,
  });
  const routeMetadata = {
    requestId: baseHandler.requestId,
    routeName,
    eventType: input.event.type,
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    operation: "route",
  } satisfies XmuxLogMetadata;
  const handler = {
    ...baseHandler,
    logger: baseHandler.logger.child(routeMetadata),
  } satisfies HandlerContext<TAdapters, TChats, TEvent["chatId"]>;
  const ctx: XmuxMiddlewareContext<TAdapters, TChats, TEvent> = {
    app: input.app,
    handler,
    event: input.event,
    route: {
      name: routeName,
      eventType: input.event.type,
    },
  };
  let index = -1;

  async function dispatch(nextIndex: number): Promise<Result<void, unknown>> {
    if (nextIndex <= index) {
      return Result.err(new XmuxMiddlewareNextAlreadyCalledError({ routeName }));
    }

    index = nextIndex;
    const middleware = input.middleware[nextIndex];

    if (middleware === undefined) {
      return (await input.handler(handler)).map(() => undefined);
    }

    return await middleware(ctx, () => dispatch(nextIndex + 1));
  }

  return await runWithXmuxLogContext(routeMetadata, async () => {
    const startedAt = startXmuxLogTimer();
    input.app.logger.debug(xmuxLogEvents.routeBegin, routeMetadata);

    const handled = await Result.tryPromise({
      try: () => dispatch(0),
      catch: (cause) => new XmuxMiddlewareExecutionError({ routeName, cause }),
    });
    const result = Result.andThen(handled, (inner) => inner);

    logXmuxResult({
      logger: input.app.logger,
      result,
      startedAt,
      metadata: routeMetadata,
      successEvent: xmuxLogEvents.routeSuccess,
      failureEvent: xmuxLogEvents.routeFailure,
      failureLevel: "error",
    });

    return result;
  });
}

function defaultRouteName(event: XmuxRoutedChatEvent): string {
  if (isCommandEvent(event)) {
    return event.command.name;
  }

  if (isNamedCommandEvent(event)) {
    return event.commandName;
  }

  return event.type;
}

type RoutedCommandEvent = XmuxRoutedChatEvent & {
  readonly command: { readonly name: string };
};

type RoutedNamedCommandEvent = XmuxRoutedChatEvent & {
  readonly commandName: string;
};

function isCommandEvent(event: XmuxRoutedChatEvent): event is RoutedCommandEvent {
  if (!("command" in event)) {
    return false;
  }

  const command = event.command;
  return (
    typeof command === "object" &&
    command !== null &&
    "name" in command &&
    typeof command.name === "string"
  );
}

function isNamedCommandEvent(event: XmuxRoutedChatEvent): event is RoutedNamedCommandEvent {
  return "commandName" in event && typeof event.commandName === "string";
}
