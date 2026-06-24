import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef, SessionRecord } from "../../store";
import type { PromptAlreadyRunningError } from "./errors";
import type { PromptMessageEvent } from "./handler";

export type PromptEventType = "prompt.busy" | "prompt.settled";

export type PromptEvent<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> = PromptBusyEvent<TAdapters, TChats> | PromptSettledEvent<TAdapters, TChats>;

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
  ): Promise<ResultType<void, unknown>>;
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
        handler: (event) => handler(event as never),
      };
      handlers.add(stored);
      return () => {
        handlers.delete(stored);
      };
    },

    async emit(event) {
      for (const subscription of handlers) {
        if (subscription.type !== event.type) continue;

        const handled = await Result.tryPromise({
          try: () => subscription.handler(event),
          catch: (cause) => cause,
        });
        const result = Result.andThen(handled, (inner) => inner);
        if (result.isErr()) return result;
      }

      return Result.ok();
    },
  };
}
