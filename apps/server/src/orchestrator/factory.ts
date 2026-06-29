import type {
  Config,
  Result,
  Store,
  XmuxCloseError,
  XmuxInitializeError,
  XmuxLogger,
  XmuxRuntimeStatusSnapshot,
} from "@xmux/orchestrator";
import { Context, Effect } from "effect";
import type { EffectiveServerConfig } from "../config/effective";
import type { OrchestratorConfigurationError } from "./errors";
import type { ServerXmuxMiddleware } from "./middleware";

export interface OrchestratorRuntime {
  status(): XmuxRuntimeStatusSnapshot;
  initialize(): Promise<Result<void, XmuxInitializeError>>;
  shutdown(): Promise<Result<void, XmuxCloseError>>;
}

export interface CreateOrchestratorRuntimeInput {
  readonly effectiveConfig: EffectiveServerConfig;
  readonly config: Config;
  readonly store: Store;
  readonly logger: XmuxLogger;
  readonly middleware: readonly ServerXmuxMiddleware[];
}

export class OrchestratorFactory extends Context.Service<
  OrchestratorFactory,
  {
    readonly create: (
      input: CreateOrchestratorRuntimeInput,
    ) => Effect.Effect<OrchestratorRuntime, OrchestratorConfigurationError>;
  }
>()("@xmux/server/OrchestratorFactory") {}
