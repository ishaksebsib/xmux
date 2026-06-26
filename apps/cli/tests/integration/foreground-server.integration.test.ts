import { describe, expect, it } from "@effect/vitest";
import { resolveXmuxServerPaths } from "@xmux/server/platform/node";
import { Effect } from "effect";
import { cliRuntimeEnvForRoot, withEnvVars } from "../support/env";
import { makeCliSandbox, minimalConfig } from "../support/sandbox";
import { isExited, spawnForegroundCli, waitForCondition, waitForExit } from "../support/subprocess";

const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;
const posixIt = process.platform === "win32" ? it.live.skip : it.live;

describeIntegration("server run foreground subprocess", () => {
  posixIt(
    "cleans manifest and socket after SIGTERM and shuts down once",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* makeCliSandbox;
        yield* sandbox.writeConfig(minimalConfig());

        const cliEnv = cliRuntimeEnvForRoot(sandbox.root);
        const env = {
          ...process.env,
          ...cliEnv,
        };
        const paths = yield* withEnvVars(
          cliEnv,
          resolveXmuxServerPaths({ configPath: sandbox.configPath }),
        );
        const subprocess = yield* spawnForegroundCli({ configPath: sandbox.configPath, env });

        const started = yield* waitForCondition({
          check: sandbox
            .exists(paths.manifestPath)
            .pipe(Effect.map((manifestExists) => manifestExists && !isExited(subprocess.child))),
          timeoutMs: 15_000,
        });
        expect(started, yield* subprocess.output).toBe(true);

        subprocess.child.kill("SIGTERM");
        yield* waitForExit(subprocess.child);

        const cleaned = yield* waitForCondition({
          check: Effect.gen(function* () {
            const manifestExists = yield* sandbox.exists(paths.manifestPath);
            const socketExists = yield* sandbox.exists(paths.controlEndpoint.path);
            return !manifestExists && !socketExists;
          }),
          timeoutMs: 3_000,
        });
        const output = yield* subprocess.output;
        expect(cleaned, output).toBe(true);
        expect(output.match(/server stopped/g) ?? []).toHaveLength(1);
        expect(subprocess.stderr.join("")).toBe("");
      }),
    25_000,
  );
});
