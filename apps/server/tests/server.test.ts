import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { runXmuxServer, serverProgram, ServerShell } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const fixedClock = {
  now: () => fixedStartedAt,
};
const immediateShutdown = Effect.succeed(undefined);

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "server-boundary-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() => access(path).then(() => true, () => false));

it.effect("constructs the server program with a fake shell layer", () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const fakeShellLayer = Layer.succeed(ServerShell)({
      acquire: (options) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const startedAt = options.clock.now();
            events.push(`acquire:${startedAt.toISOString()}`);
            return { startedAt };
          }),
          (handle) =>
            Effect.sync(() => {
              events.push(`release:${handle.startedAt.toISOString()}`);
            }),
        ),
    });

    yield* Effect.scoped(
      serverProgram({
        clock: fixedClock,
        controlEndpointOverride: { kind: "test", id: "unit" },
        shutdownSignal: immediateShutdown,
      }),
    ).pipe(Effect.provide(fakeShellLayer));

    assert.deepStrictEqual(events, [
      "acquire:2026-06-16T00:00:00.000Z",
      "release:2026-06-16T00:00:00.000Z",
    ]);
  }),
);

it.effect("exposes a public Effect boundary with temp runtime paths", () =>
  Effect.gen(function* () {
    const root = yield* makeTempRoot;
    const manifestPath = join(root, "server.json");

    yield* runXmuxServer({
      configPath: join(root, "config.jsonc"),
      pathOverrides: {
        stateDir: join(root, "state"),
        runtimeDir: join(root, "runtime"),
        logDir: join(root, "logs"),
        dbPath: join(root, "state", "server.db"),
        manifestPath,
        startupLockPath: join(root, "startup.lock"),
      },
      clock: fixedClock,
      shutdownSignal: immediateShutdown,
    });

    assert.isFalse(yield* exists(manifestPath));
  }),
);
