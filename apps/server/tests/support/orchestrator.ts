import { Result, type XmuxCloseError, type XmuxInitializeError } from "@xmux/orchestrator";
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

export const makeTestOrchestratorFactoryLayer = (
  input: {
    readonly create?: (
      options: CreateOrchestratorRuntimeInput,
    ) => Effect.Effect<OrchestratorRuntime, OrchestratorConfigurationError>;
    readonly initialize?: OrchestratorRuntime["initialize"];
    readonly shutdown?: OrchestratorRuntime["shutdown"];
  } = {},
) =>
  Layer.succeed(OrchestratorFactory)({
    create:
      input.create ??
      (() =>
        Effect.succeed({
          initialize: input.initialize ?? okInitialize,
          shutdown: input.shutdown ?? okShutdown,
        })),
  });

export const testOrchestratorFactoryLayer = makeTestOrchestratorFactoryLayer();
