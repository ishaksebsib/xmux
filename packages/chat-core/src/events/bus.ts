import { chatLogEvents, type ChatLogScope, type ChatLogEventName } from "../logger";
import { serializeChatLogError } from "../logger-utils";
import type { ChatEvent, ChatEventHandler, ChatEventType, Unsubscribe } from "./types";

type StoredHandler = {
  readonly type: ChatEventType;
  readonly key?: string;
  readonly handler: ChatEventHandler;
};

/**
 * Event registry + dispatcher operating on the erased `ChatEvent` default.
 * The facade casts strong event types to this boundary once, in `emit`.
 */
export function createEventBus(args: { readonly logger?: ChatLogScope<ChatLogEventName> } = {}) {
  const handlers = new Set<StoredHandler>();

  function reportHandlerError(event: ChatEvent, cause: unknown) {
    args.logger?.error(chatLogEvents.eventHandlerFailure, {
      chatId: event.chatId,
      eventType: event.type,
      eventKey: keyFor(event),
      error: serializeChatLogError(cause),
    });

    if (event.type === "error") return;
    dispatch({ type: "error", chatId: event.chatId, error: cause });
  }

  function dispatch(event: ChatEvent) {
    const key = keyFor(event);
    for (const subscription of handlers) {
      if (subscription.type !== event.type) continue;
      if (subscription.key !== undefined && subscription.key !== key) continue;
      try {
        void Promise.resolve(subscription.handler(event)).catch((cause: unknown) => {
          reportHandlerError(event, cause);
        });
      } catch (cause) {
        reportHandlerError(event, cause);
      }
    }
  }

  function on(
    type: ChatEventType,
    commandOrHandler: string | ChatEventHandler,
    maybeHandler?: ChatEventHandler,
  ): Unsubscribe {
    const key = typeof commandOrHandler === "string" ? commandOrHandler : undefined;
    const handler = typeof commandOrHandler === "string" ? maybeHandler : commandOrHandler;
    if (handler === undefined) {
      throw new TypeError("chat.on requires an event handler");
    }

    const subscription = { type, key, handler };
    handlers.add(subscription);
    return () => {
      handlers.delete(subscription);
    };
  }

  return { dispatch, on };
}

function keyFor(event: {
  readonly type: ChatEventType;
  readonly command?: { readonly name: string };
  readonly commandName?: string;
  readonly actionId?: string;
}): string | undefined {
  if (event.type === "command") return event.command?.name;
  if (event.type === "command.invalid" || event.type === "command.unknown")
    return event.commandName;
  return event.type === "action" ? event.actionId : undefined;
}
