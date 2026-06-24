import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, TaggedError, type Result as ResultType } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef, SessionRecord } from "../../store";
import type { PromptAlreadyRunningError } from "./errors";
import type { PromptMessageEvent } from "./handler";
import type { PromptSessionForThreadError } from "./service";

export type PromptEventType =
  | "prompt.busy"
  | "prompt.started"
  | "prompt.settled"
  | "prompt.rejected";

export type PromptEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> =
  | PromptBusyEvent<TAdapters, TChats>
  | PromptStartedEvent<TAdapters, TChats>
  | PromptSettledEvent<TAdapters, TChats>
  | PromptRejectedEvent<TAdapters, TChats>;

export interface PromptBusyEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly type: "prompt.busy";
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent;
  readonly thread: ChatThreadRef;
  readonly error: PromptAlreadyRunningError;
}

export interface PromptStartedEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly type: "prompt.started";
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent;
  readonly thread: ChatThreadRef;
  readonly session: SessionRecord;
  readonly requestId: string;
}

export interface PromptSettledEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly type: "prompt.settled";
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent;
  readonly thread: ChatThreadRef;
  readonly session: SessionRecord;
  readonly requestId: string;
}

export interface PromptRejectedEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly type: "prompt.rejected";
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent;
  readonly thread: ChatThreadRef;
  readonly error: PromptSessionForThreadError;
  readonly requestId: string;
}

export interface PromptEventDispatchOutput {
  readonly handledCount: number;
}

export class PromptEventDispatchError extends TaggedError("PromptEventDispatchError")<{
  readonly eventType: PromptEventType;
  readonly handlerIndex: number;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly eventType: PromptEventType;
    readonly handlerIndex: number;
    readonly cause: unknown;
  }) {
    const causeMessage = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Prompt event ${args.eventType} handler ${args.handlerIndex} failed: ${causeMessage}`,
    });
  }
}

export type PromptEventHandler<TType extends PromptEventType> = <
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  event: Extract<PromptEvent<TAdapters, TChats>, { readonly type: TType }>,
) => Promise<ResultType<void, unknown>>;

export interface PromptEventBus {
  on<TType extends PromptEventType>(type: TType, handler: PromptEventHandler<TType>): Unsubscribe;
  emit<
    TAdapters extends HarnessAdapterDefinitions<TAdapters>,
    TChats extends ChatAdapterDefinitions<TChats>,
  >(
    event: PromptEvent<TAdapters, TChats>,
  ): Promise<ResultType<PromptEventDispatchOutput, PromptEventDispatchError>>;
}

type StoredPromptEventHandler = {
  readonly type: PromptEventType;
  readonly handler: <
    TAdapters extends HarnessAdapterDefinitions<TAdapters>,
    TChats extends ChatAdapterDefinitions<TChats>,
  >(
    event: PromptEvent<TAdapters, TChats>,
  ) => Promise<ResultType<void, unknown>>;
};

export function createPromptEventBus(): PromptEventBus {
  const handlers = new Set<StoredPromptEventHandler>();

  return {
    on(type, handler) {
      const stored: StoredPromptEventHandler = {
        type,
        handler: (event) => {
          if (!isPromptEventType(event, type)) return Promise.resolve(Result.ok());
          return handler(event);
        },
      };
      handlers.add(stored);
      return () => {
        handlers.delete(stored);
      };
    },

    async emit(event) {
      let handledCount = 0;
      let handlerIndex = 0;

      for (const subscription of handlers) {
        if (subscription.type !== event.type) continue;

        const currentIndex = handlerIndex;
        handlerIndex += 1;
        const handled = await Result.tryPromise({
          try: () => subscription.handler(event),
          catch: (cause) =>
            new PromptEventDispatchError({
              eventType: event.type,
              handlerIndex: currentIndex,
              cause,
            }),
        });
        const result = Result.andThen(handled, (inner) =>
          Result.mapError(
            inner,
            (cause) =>
              new PromptEventDispatchError({
                eventType: event.type,
                handlerIndex: currentIndex,
                cause,
              }),
          ),
        );
        if (result.isErr()) return Result.err(result.error);
        handledCount += 1;
      }

      return Result.ok({ handledCount });
    },
  };
}

function isPromptEventType<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TType extends PromptEventType,
>(
  event: PromptEvent<TAdapters, TChats>,
  type: TType,
): event is Extract<PromptEvent<TAdapters, TChats>, { readonly type: TType }> {
  return event.type === type;
}
