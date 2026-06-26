import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { runServerRunCommand } from "../src/commands/server-run";
import { CliInvalidInput } from "../src/domain/errors";
import { renderCliCause } from "../src/output/errors";
import { nodeServerRunnerLayer } from "../src/platform/node/server-runner";
import { ServerRunner } from "../src/process/server-runner";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox } from "./support/sandbox";

describe("server run foreground command", () => {
  it.effect("requires --foreground before reading ServerRunner", () =>
    Effect.gen(function* () {
      let runnerCalled = false;
      const fakeRunner = Layer.succeed(ServerRunner, {
        runForeground: () =>
          Effect.sync(() => {
            runnerCalled = true;
          }),
      });

      const exit = yield* Effect.exit(
        runServerRunCommand({ foreground: false, configPath: Option.none() }).pipe(
          Effect.provide(fakeRunner),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliInvalidInput);
        expect(renderCliCause(exit.cause, false)).toBe(
          "Use --foreground to run the xmux server in this process.",
        );
      }
      expect(runnerCalled).toBe(false);
    }),
  );

  it.effect("delegates foreground execution to ServerRunner", () =>
    Effect.gen(function* () {
      let calledWith: string | undefined;
      const fakeRunner = Layer.succeed(ServerRunner, {
        runForeground: ({ configPath }) =>
          Effect.sync(() => {
            calledWith = configPath;
          }),
      });

      yield* runServerRunCommand({
        foreground: true,
        configPath: Option.some("/tmp/xmux.jsonc"),
      }).pipe(Effect.provide(fakeRunner));

      expect(calledWith).toBe("/tmp/xmux.jsonc");
    }),
  );

  it.effect("parses invalid --config before reading ServerRunner", () =>
    Effect.gen(function* () {
      let runnerCalled = false;
      const fakeRunner = Layer.succeed(ServerRunner, {
        runForeground: () =>
          Effect.sync(() => {
            runnerCalled = true;
          }),
      });

      const exit = yield* Effect.exit(
        runServerRunCommand({ foreground: true, configPath: Option.some("") }).pipe(
          Effect.provide(fakeRunner),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliInvalidInput);
        expect(renderCliCause(exit.cause, false)).toBe("Invalid --config path.");
      }
      expect(runnerCalled).toBe(false);
    }),
  );

  it.live("renders invalid config failures without raw config contents", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeCliSandbox;
      const configPath = join(sandbox.root, "invalid.jsonc");
      yield* sandbox.writeText(configPath, "{ invalid json }");

      const exit = yield* withEnvVars(
        cliRuntimeEnvForRoot(sandbox.root),
        Effect.exit(
          runServerRunCommand({ foreground: true, configPath: Option.some(configPath) }).pipe(
            Effect.provide(nodeServerRunnerLayer),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const rendered = renderCliCause(exit.cause, false);
        expect(rendered).toContain("offset");
        expect(rendered).not.toContain("invalid json");
      }
    }),
  );
});
