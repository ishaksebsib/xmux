import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { runXmuxServer, ServerShell, xmuxServerProgram } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const fixedClock = {
  now: () => fixedStartedAt,
};
const immediateShutdown = Effect.succeed(undefined);

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
      xmuxServerProgram({
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

it.effect("exposes a public Effect boundary that can shut down immediately", () =>
  runXmuxServer({
    clock: fixedClock,
    shutdownSignal: immediateShutdown,
  }),
);
