import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "./ctx";
import { registerDeleteRoute } from "./features/delete";
import { registerExitRoute } from "./features/exit";
import { registerNewRoute } from "./features/new";
import { registerPromptRoute } from "./features/prompt";
import { registerResumeRoute } from "./features/resume";
import { registerUnknownCommandRoute } from "./features/unknown-command";
import { registerCdRoute, registerLsRoute, registerPwdRoute } from "./features/workspace";

/** Registers all built-in chat routes. */
export function registerRoutes<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): readonly Unsubscribe[] {
  return [
    registerNewRoute(ctx),
    registerResumeRoute(ctx),
    registerDeleteRoute(ctx),
    registerExitRoute(ctx),
    registerPwdRoute(ctx),
    registerCdRoute(ctx),
    registerLsRoute(ctx),
    registerPromptRoute(ctx),
    registerUnknownCommandRoute(ctx),
  ];
}
