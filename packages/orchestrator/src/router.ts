import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "./ctx";
import type { XmuxMiddleware } from "./middleware";
import { registerCancelRoute } from "./features/cancel";
import { registerDeleteRoute } from "./features/delete";
import { registerExitRoute } from "./features/exit";
import { registerIdRoute } from "./features/id";
import { registerInteractionRoute } from "./features/interaction";
import { registerModelRoute } from "./features/model";
import { registerNewRoute } from "./features/new";
import { registerPromptRoute } from "./features/prompt";
import { registerQueueRoute } from "./features/queue";
import { registerResumeRoute } from "./features/resume";
import { registerSttRoute } from "./features/stt";
import { registerThinkingRoute } from "./features/thinking";
import { registerUnknownCommandRoute } from "./features/unknown-command";
import { registerCdRoute, registerLsRoute, registerPwdRoute } from "./features/workspace";

/** Registers all built-in chat routes. */
export function registerRoutes<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): readonly Unsubscribe[] {
  return [
    registerNewRoute(ctx, middleware),
    registerResumeRoute(ctx, middleware),
    registerDeleteRoute(ctx, middleware),
    registerExitRoute(ctx, middleware),
    registerModelRoute(ctx, middleware),
    registerThinkingRoute(ctx, middleware),
    registerCancelRoute(ctx, middleware),
    registerQueueRoute(ctx, middleware),
    registerIdRoute(ctx, middleware),
    registerInteractionRoute(ctx, middleware),
    registerSttRoute(ctx, middleware),
    registerPwdRoute(ctx, middleware),
    registerCdRoute(ctx, middleware),
    registerLsRoute(ctx, middleware),
    registerPromptRoute(ctx, middleware),
    registerUnknownCommandRoute(ctx, middleware),
  ];
}
