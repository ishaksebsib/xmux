import { Context, Effect, Layer, Scope } from "effect";
import type { ServerError } from "./errors";
import {
  normalizeRunXmuxServerOptions,
  type NormalizedRunXmuxServerOptions,
  type RunXmuxServerOptions,
} from "./options";

export interface ServerShellHandle {
  readonly startedAt: Date;
}

export class ServerShell extends Context.Service<
  ServerShell,
  {
    readonly acquire: (
      options: NormalizedRunXmuxServerOptions,
    ) => Effect.Effect<ServerShellHandle, ServerError, Scope.Scope>;
  }
>()("@xmux/server/ServerShell") {}

export const ServerShellLive = Layer.succeed(ServerShell)({
  acquire: (options) =>
    Effect.acquireRelease(
      Effect.sync<ServerShellHandle>(() => ({
        startedAt: options.clock.now(),
      })).pipe(
        Effect.tap((handle) =>
          Effect.logInfo("xmux server shell started", {
            startedAt: handle.startedAt.toISOString(),
          }),
        ),
      ),
      (handle) =>
        Effect.logInfo("xmux server shell stopped", {
          startedAt: handle.startedAt.toISOString(),
        }),
    ),
});

export const xmuxServerProgram = Effect.fn("xmux.serverProgram")(function* (
  options: RunXmuxServerOptions,
) {
  const normalizedOptions = normalizeRunXmuxServerOptions(options);
  const shell = yield* ServerShell;

  yield* shell.acquire(normalizedOptions);
  yield* normalizedOptions.shutdownSignal;
});

export const runXmuxServer = (options: RunXmuxServerOptions): Effect.Effect<void, ServerError> =>
  Effect.scoped(xmuxServerProgram(options)).pipe(Effect.provide(ServerShellLive));
