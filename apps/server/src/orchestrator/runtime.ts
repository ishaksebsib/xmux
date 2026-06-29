import {
  Result,
  createXmuxResult,
  type CreateXmuxOptions,
  type Result as ResultType,
  type XmuxConfigurationError,
} from "@xmux/orchestrator";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Effect } from "effect";
import type { EffectiveServerConfig } from "../config/effective";
import { OrchestratorStore } from "../db/orchestrator-store";
import { decideOrchestratorActivation } from "./activation";
import { mapEffectiveConfigToXmuxConfig } from "./config-map";
import { OrchestratorFactory, type OrchestratorRuntime } from "./factory";
import { makeOrchestratorLogger } from "./logger";
import { OrchestratorStatusRegistry, safeOrchestratorStatusReason } from "./status-registry";
import { safeStatusReasonFromString } from "./status-model";
import { makeServerOrchestratorMiddleware } from "./middleware";
import {
  OrchestratorConfigurationError,
  OrchestratorShutdownError,
  OrchestratorStartupError,
} from "./errors";

const resultToEffect = <A, E>(result: ResultType<A, E>): Effect.Effect<A, E> =>
  Result.match(result, {
    ok: (value): Effect.Effect<A, E> => Effect.succeed(value),
    err: (error): Effect.Effect<A, E> => Effect.fail(error),
  });

const mapXmuxConfigurationError = (error: XmuxConfigurationError): OrchestratorConfigurationError =>
  OrchestratorConfigurationError.make({
    path: error.path,
    reason: error.reason,
    message: error.message,
    cause: error,
  });

export const createXmuxRuntime = <
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends ChatAdapterDefinitions<TChats>,
>(
  options: CreateXmuxOptions<TAdapters, TChats>,
): Effect.Effect<OrchestratorRuntime, OrchestratorConfigurationError> =>
  Effect.sync(() => createXmuxResult(options)).pipe(
    Effect.flatMap((result) =>
      resultToEffect(result).pipe(Effect.mapError(mapXmuxConfigurationError)),
    ),
  );

const initializeOrchestratorRuntime = Effect.fn("server.orchestrator.initialize")(function* (
  runtime: OrchestratorRuntime,
) {
  const initialized = yield* Effect.tryPromise({
    try: () => runtime.initialize(),
    catch: (cause) =>
      OrchestratorStartupError.make({
        message: "Failed to initialize orchestrator runtime.",
        cause,
      }),
  });

  return yield* resultToEffect(initialized).pipe(
    Effect.mapError((cause) =>
      OrchestratorStartupError.make({
        message: cause.message,
        cause,
      }),
    ),
  );
});

const shutdownOrchestratorRuntime = (runtime: OrchestratorRuntime): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => runtime.shutdown(),
    catch: (cause) =>
      OrchestratorShutdownError.make({
        message: "Failed to shut down orchestrator runtime.",
        cause,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      resultToEffect(result).pipe(
        Effect.mapError((cause) =>
          OrchestratorShutdownError.make({
            message: cause.message,
            cause,
          }),
        ),
      ),
    ),
    Effect.tapError((error) =>
      Effect.logWarning("orchestrator shutdown failed", {
        errorTag: error._tag,
        message: error.message,
      }),
    ),
    Effect.ignore,
  );

export const startOrchestrator = Effect.fn("server.orchestrator.start")(function* (
  config: EffectiveServerConfig,
) {
  const registry = yield* OrchestratorStatusRegistry;
  const activation = decideOrchestratorActivation(config);

  if (activation._tag === "Disabled") {
    yield* registry.markDisabled(activation);
    if (activation.harnesses.length > 0) {
      yield* Effect.logWarning("orchestrator disabled because no chats are configured", {
        harnesses: activation.harnesses,
      });
    } else {
      yield* Effect.logInfo("orchestrator disabled because no chats are configured");
    }
    return activation;
  }

  if (activation._tag === "Invalid") {
    yield* registry.markFailed(activation, safeStatusReasonFromString(activation.reason));
    return yield* OrchestratorConfigurationError.make({
      path: "harnesses",
      reason: activation.reason,
      message: activation.message,
    });
  }

  yield* registry.markStarting(activation);

  const factory = yield* OrchestratorFactory;
  const store = yield* OrchestratorStore;
  const xmuxConfig = mapEffectiveConfigToXmuxConfig(config);
  const logger = yield* makeOrchestratorLogger();
  const middleware = makeServerOrchestratorMiddleware(config);

  const runtime = yield* factory
    .create({
      effectiveConfig: config,
      config: xmuxConfig,
      store,
      logger,
      middleware,
    })
    .pipe(
      Effect.tapError((error) =>
        registry.markFailed(activation, safeOrchestratorStatusReason(error)),
      ),
    );

  const startupResult = yield* initializeOrchestratorRuntime(runtime).pipe(
    Effect.as("running" as const),
    Effect.catch((error) =>
      Effect.gen(function* () {
        const reason = safeOrchestratorStatusReason(error);
        const snapshot = runtime.status();

        if (!snapshot.chats.adapters.some((adapter) => adapter.state === "failed")) {
          yield* registry.markFailed(activation, reason);
          yield* shutdownOrchestratorRuntime(runtime);
          return yield* Effect.fail(error);
        }

        yield* registry.markRuntimeFailed(activation, snapshot, reason);
        yield* shutdownOrchestratorRuntime(runtime);
        yield* Effect.logWarning(
          "orchestrator startup failed; server remains available for diagnostics",
          {
            chats: activation.chats,
            harnesses: activation.harnesses,
            reason,
          },
        );
        return "diagnostics_only" as const;
      }),
    ),
  );

  if (startupResult === "diagnostics_only") return activation;

  yield* registry.attachRuntime(activation, () => runtime.status());
  yield* Effect.acquireRelease(Effect.succeed(runtime), (acquired) =>
    Effect.gen(function* () {
      yield* registry.markStopping();
      yield* shutdownOrchestratorRuntime(acquired);
      yield* registry.markStopped();
    }),
  );
  yield* Effect.logInfo("orchestrator started", {
    chats: activation.chats,
    harnesses: activation.harnesses,
  });

  return activation;
});
