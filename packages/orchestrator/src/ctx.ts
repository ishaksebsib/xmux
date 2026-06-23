import type { Chat, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { Harness, HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import type { Actions } from "./actions";
import type { Commands } from "./commands";
import type { NormalizedConfig } from "./config";
import type { FileSystemHost } from "./filesystem";
import type { Store } from "./store";
import type { XmuxLogScope } from "./logger";
import type { PromptRunRegistry } from "./features/prompt/run-registry";
import type { SttRunRegistry } from "./features/stt/run-registry";

/**
 * Long-lived application context.
 *
 * This should be created once by `createXmux()` and passed to higher-level app
 * code instead of leaking raw runtime objects everywhere.
 */
export interface Context<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly kind: "xmux";
  readonly config: NormalizedConfig;
  readonly harnessIds: readonly Extract<keyof TAdapters, string>[];
  readonly chatIds: readonly Extract<keyof TChats, string>[];
  readonly harness: Harness<TAdapters>;
  readonly chat: Chat<TChats, Commands, Actions>;
  /** Store for owned routing and session metadata. */
  readonly store: Store;
  readonly fs: FileSystemHost;
  readonly logger: XmuxLogScope;
  readonly services: Services;
}

/**
 * Short-lived request-scoped context for internal handlers and app code.
 */
export interface HandlerContext<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
  THarnessId extends Extract<keyof TAdapters, string> = Extract<keyof TAdapters, string>,
> {
  readonly app: Context<TAdapters, TChats>;
  readonly chatId: TChatId;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly logger: XmuxLogScope;
  readonly actor?: Actor;
  readonly session?: HandlerSession<THarnessId>;
}

export interface CreateHandlerContextInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
  THarnessId extends Extract<keyof TAdapters, string> = Extract<keyof TAdapters, string>,
> {
  readonly app: Context<TAdapters, TChats>;
  readonly chatId: TChatId;
  readonly actor?: Actor;
  readonly session?: HandlerSession<THarnessId>;
}

/** Creates request-scoped context for one routed handler invocation. */
export function createHandlerContext<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
  THarnessId extends Extract<keyof TAdapters, string> = Extract<keyof TAdapters, string>,
>(
  input: CreateHandlerContextInput<TAdapters, TChats, TChatId, THarnessId>,
): HandlerContext<TAdapters, TChats, TChatId, THarnessId> {
  const requestId = input.app.services.createRequestId();

  return {
    app: input.app,
    chatId: input.chatId,
    requestId,
    signal: input.app.services.shutdownSignal,
    logger: input.app.logger.child({ requestId, chatId: input.chatId }),
    actor: input.actor,
    session: input.session,
  };
}

/** Stable app-scoped services shared across handlers. */
export interface Services {
  readonly createRequestId: () => string;
  readonly now: () => Date;
  readonly shutdownSignal: AbortSignal;
  readonly promptRuns: PromptRunRegistry;
  readonly sttRuns: SttRunRegistry;
}

/** User identity associated with a handler invocation. */
export interface Actor {
  readonly userId: string;
  readonly displayName?: string;
}

/** Active harness session already associated with the current handler. */
export type HandlerSession<THarnessId extends string = string> = SessionRef<THarnessId>;
