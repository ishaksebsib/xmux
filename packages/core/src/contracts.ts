//TODO: move this to xmux.ts or other file
import type { Result } from "better-result";
import type { HarnessAdapterDefinitions, HarnessCloseError } from "@xmux/harness-core";
import type { Adapter } from "chat";
import type { XmuxCloseError, XmuxInitializeError } from "./errors";
import type { XmuxConfig } from "./config";
import type { XmuxContext } from "./ctx";

/**
 * Main xmux instance - manages harnesses and chats together.
 * Provides lifecycle control and webhook access.
 */
export interface Xmux<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends Record<string, Adapter>,
> {
  readonly ctx: XmuxContext<TAdapters, TChats>;
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
