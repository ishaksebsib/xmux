import {
  Result,
  type XmuxCloseError,
  type XmuxInitializeError,
  type XmuxRuntimeStatusSnapshot,
} from "@xmux/orchestrator";
import { Effect, Layer } from "effect";
import {
  OrchestratorFactory,
  type CreateOrchestratorRuntimeInput,
  type OrchestratorRuntime,
} from "../../src/orchestrator/factory";
import type { OrchestratorConfigurationError } from "../../src/orchestrator/errors";

const okInitialize = (): Promise<Result<void, XmuxInitializeError>> =>
  Promise.resolve(Result.ok<void, XmuxInitializeError>(undefined));

const okShutdown = (): Promise<Result<void, XmuxCloseError>> =>
  Promise.resolve(Result.ok<void, XmuxCloseError>(undefined));

const okStatus = (): XmuxRuntimeStatusSnapshot => ({
  chats: { lifecycle: "started", adapters: [{ id: "telegram", state: "active" }] },
  harnesses: { adapters: [{ id: "opencode", state: "configured_lazy" }] },
});

export const makeTestOrchestratorFactoryLayer = (
  input: {
    readonly create?: (
      options: CreateOrchestratorRuntimeInput,
    ) => Effect.Effect<OrchestratorRuntime, OrchestratorConfigurationError>;
    readonly status?: OrchestratorRuntime["status"];
    readonly initialize?: OrchestratorRuntime["initialize"];
    readonly shutdown?: OrchestratorRuntime["shutdown"];
  } = {},
) =>
  Layer.succeed(OrchestratorFactory)({
    create:
      input.create ??
      (() =>
        Effect.succeed({
          status: input.status ?? okStatus,
          initialize: input.initialize ?? okInitialize,
          shutdown: input.shutdown ?? okShutdown,
        })),
  });

export const testOrchestratorFactoryLayer = makeTestOrchestratorFactoryLayer();
