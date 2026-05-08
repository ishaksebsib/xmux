//TODO: move this to xmux.ts or other file
import type { Result } from "better-result";
import type { HarnessAdapterDefinitions, HarnessCloseError } from "@xmux/harness-core";
import type { Adapter, Chat } from "chat";
import type { XmuxCloseError, XmuxInitializeError } from "./errors";
import type { XmuxConfig } from "./config";

/**
 * Main xmux instance - manages harnesses and chats together.
 * Provides lifecycle control and webhook access.
 */
export interface Xmux<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends Record<string, Adapter>,
> {
  readonly harnessIds: readonly Extract<keyof TAdapters, string>[];
  readonly chatIds: readonly Extract<keyof TChats, string>[];
  readonly config: XmuxConfig;
  readonly webhooks: Chat["webhooks"]; // TODO: change the type to our own xmux core
  initialize(): Promise<Result<void, XmuxInitializeError>>;
  shutdown(): Promise<Result<void, XmuxCloseError>>;
}

export interface CreateXmuxOptions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends Record<string, Adapter>,
> {
  readonly harnesses: TAdapters;
  readonly chats: TChats;
  readonly config: XmuxConfig;
}

export type XmuxCloseCause = {
  readonly harness?: HarnessCloseError;
  readonly chat?: unknown;
};
