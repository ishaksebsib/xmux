import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "./ctx";
import { registerNewRoute } from "./features/new";
import { registerUnknownCommandRoute } from "./features/unknown-command";
import { registerCdRoute, registerPwdRoute } from "./features/workspace";

/** Registers all built-in chat routes. */
export function registerRoutes<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): readonly Unsubscribe[] {
  return [
    registerNewRoute(ctx),
    registerPwdRoute(ctx),
    registerCdRoute(ctx),
    registerUnknownCommandRoute(ctx),
  ];
}
