import type {
  Config,
  Result,
  Store,
  XmuxCloseError,
  XmuxInitializeError,
  XmuxLogger,
} from "@xmux/orchestrator";
import { Context, Effect } from "effect";
import type { EffectiveServerConfig } from "../config/effective";
import type { OrchestratorConfigurationError } from "./errors";

export interface OrchestratorRuntime {
  initialize(): Promise<Result<void, XmuxInitializeError>>;
  shutdown(): Promise<Result<void, XmuxCloseError>>;
}

export interface CreateOrchestratorRuntimeInput {
  readonly effectiveConfig: EffectiveServerConfig;
  readonly config: Config;
  readonly store: Store;
  readonly logger: XmuxLogger;
}

export class OrchestratorFactory extends Context.Service<
  OrchestratorFactory,
  {
    readonly create: (
      input: CreateOrchestratorRuntimeInput,
    ) => Effect.Effect<OrchestratorRuntime, OrchestratorConfigurationError>;
  }
>()("@xmux/server/OrchestratorFactory") {}
