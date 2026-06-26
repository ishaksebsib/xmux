import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { runServerRunCommand } from "../src/commands/server-run";
import { CliInvalidInput } from "../src/domain/errors";
import { renderCliCause } from "../src/output/errors";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox } from "./support/sandbox";

describe("server run foreground command", () => {
  it.effect("requires --foreground", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runServerRunCommand({ foreground: false, configPath: Option.none() }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliInvalidInput);
        expect(renderCliCause(exit.cause, false)).toBe(
          "Use --foreground to run the xmux server in this process.",
        );
      }
    }),
  );

  it.live("renders invalid config failures without raw config contents", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeCliSandbox;
      const configPath = join(sandbox.root, "invalid.jsonc");
      yield* sandbox.writeText(configPath, "{ invalid json }");

      const exit = yield* withEnvVars(
        cliRuntimeEnvForRoot(sandbox.root),
        Effect.exit(runServerRunCommand({ foreground: true, configPath: Option.some(configPath) })),
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
