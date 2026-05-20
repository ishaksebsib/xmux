import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { XmuxContext } from "./ctx";
import { registerNewRoute } from "./features/new";

/** Registers all built-in xmux chat routes. */
export function registerXmuxRoutes<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: XmuxContext<TAdapters, TChats>): readonly Unsubscribe[] {
  return [registerNewRoute(ctx)];
}
