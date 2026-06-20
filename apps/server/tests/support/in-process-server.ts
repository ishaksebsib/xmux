import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Fiber, Layer, Schema, Scope } from "effect";
import { makeSecretResolverLayer } from "../../src/config/resolve-secrets";
import { ServerConfigLayer } from "../../src/config/service";
import { LogReaderLayer } from "../../src/logging/log-reader";
import { NodeHostRuntime, NodeSecretResolver, NodeServerProbe, NodeUnixSocketControlTransport } from "../../src/platform/node";
import type { ServerRuntimePaths } from "../../src/runtime-state/paths";
import { RuntimePaths } from "../../src/runtime-state/runtime-paths-service";
import { ServerIdentity } from "../../src/services/server-identity";
import { ShutdownCoordinatorLayer } from "../../src/services/shutdown-coordinator";
import { StatusRegistryLayer } from "../../src/services/status-registry";
import { serverMain } from "../../src/server";
import { requestShutdown } from "./client";
import { makeSandbox } from "./sandbox";
import { waitForHealthReady } from "./wait";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");

class InProcessServerExitedBeforeReady extends Schema.TaggedErrorClass<InProcessServerExitedBeforeReady>()(
  "InProcessServerExitedBeforeReady",
  { message: Schema.String, exit: Schema.Unknown },
) {}

export const makeInProcessServerLayer = (input: {
  readonly paths: ServerRuntimePaths;
  readonly env?: ReadonlyMap<string, string>;
}) => {
  const secretLayer = input.env === undefined ? Layer.provideMerge(NodeSecretResolver, NodeHostRuntime) : makeSecretResolverLayer(input.env);
  const base = Layer.mergeAll(
    NodeHostRuntime,
    NodeFileSystem.layer,
    NodePath.layer,
    secretLayer,
    NodeServerProbe,
    Layer.succeed(RuntimePaths)(input.paths),
    Layer.succeed(ServerIdentity)({ pid: process.pid, startedAt: fixedStartedAt, sessionId: "integration-test" }),
  );
  const withConfig = Layer.provideMerge(ServerConfigLayer, base);
  const withLogReader = Layer.provideMerge(LogReaderLayer, withConfig);
  const core = Layer.mergeAll(withLogReader, StatusRegistryLayer, ShutdownCoordinatorLayer);
  return Layer.provideMerge(NodeUnixSocketControlTransport, core);
};

export const withInProcessServer = <A>(
  input: { readonly config: string; readonly env?: ReadonlyMap<string, string> },
  use: (server: {
    readonly root: string;
    readonly paths: ServerRuntimePaths;
    readonly socketPath: string;
    readonly shutdown: Effect.Effect<void, unknown>;
  }) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeSandbox;
    yield* sandbox.writeConfig(input.config);
    const layer = makeInProcessServerLayer({ paths: sandbox.paths, env: input.env });
    const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()).pipe(Effect.provide(layer)));
    yield* Effect.race(
      waitForHealthReady(sandbox.paths.controlEndpoint.path),
      Fiber.await(fiber).pipe(
        Effect.flatMap((exit) =>
          Effect.fail(
            new InProcessServerExitedBeforeReady({
              message: "In-process server exited before readiness",
              exit,
            }),
          ),
        ),
      ),
    );
    const shutdown = requestShutdown(sandbox.paths.controlEndpoint.path).pipe(Effect.andThen(Fiber.join(fiber)));
    yield* Effect.addFinalizer(() => shutdown.pipe(Effect.ignore));
    return yield* use({ root: sandbox.root, paths: sandbox.paths, socketPath: sandbox.paths.controlEndpoint.path, shutdown });
  });
