import type { Chat, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { Harness, HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import type { XmuxCommands } from "./commands";
import type { XmuxConfig } from "./config";
import type { XmuxStore } from "./store";

/**
 * Long-lived xmux application context.
 *
 * This should be created once by `createXmux()` and passed to higher-level app
 * code instead of leaking raw runtime objects everywhere.
 */
export interface XmuxContext<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly kind: "xmux";
  readonly config: XmuxConfig;
  readonly harnessIds: readonly Extract<keyof TAdapters, string>[];
  readonly chatIds: readonly Extract<keyof TChats, string>[];
  readonly harness: Harness<TAdapters>;
  readonly chat: Chat<TChats, XmuxCommands>;
  /** Store for xmux-owned routing and session metadata. */
  readonly store: XmuxStore;
  readonly services: XmuxServices;
}

/**
 * Short-lived request-scoped context for internal handlers and app code.
 */
export interface XmuxHandlerContext<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
  THarnessId extends Extract<keyof TAdapters, string> = Extract<keyof TAdapters, string>,
> {
  readonly xmux: XmuxContext<TAdapters, TChats>;
  readonly chatId: TChatId;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly actor?: XmuxActor;
  readonly session?: XmuxHandlerSession<THarnessId>;
}

/** Stable app-scoped services shared across xmux handlers. */
export interface XmuxServices {
  readonly createRequestId: () => string;
  readonly now: () => Date;
  readonly shutdownSignal: AbortSignal;
}

/** User identity associated with a handler invocation. */
export interface XmuxActor {
  readonly userId: string;
  readonly displayName?: string;
}

/** Active harness session already associated with the current handler. */
export type XmuxHandlerSession<THarnessId extends string = string> = SessionRef<THarnessId>;
