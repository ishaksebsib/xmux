import { describe, expect, it } from "vitest";
import { Effect, Option } from "effect";
import { CliServerUnreachable } from "../src/domain/errors";
import { parseConfigPathOption, parsePollIntervalMs, parseTimeoutMs } from "../src/domain/input";
import { buildServerRunArgs, buildServerRunSpawnSpec, spawnDetached } from "../src/process/spawn";
import { waitForReachable, waitForUnreachable } from "../src/process/wait";

describe("process planning", () => {
  it("builds foreground server arguments", () => {
    expect(buildServerRunArgs(undefined)).toEqual(["server", "run", "--foreground"]);
  });

  it("builds built executable spawn specs", async () => {
    const spec = await Effect.runPromise(
      buildServerRunSpawnSpec({
        process: {
          executablePath: "/usr/bin/xmux",
          entrypointPath: undefined,
          env: { PATH: "/bin" },
        },
        configPath: undefined,
      }),
    );

    expect(spec).toEqual({
      command: "/usr/bin/xmux",
      args: ["server", "run", "--foreground"],
      env: { PATH: "/bin" },
      detached: true,
      stdio: "ignore",
    });
  });

  it("builds node script .mjs spawn specs", async () => {
    const spec = await Effect.runPromise(
      buildServerRunSpawnSpec({
        process: {
          executablePath: "/usr/bin/node",
          entrypointPath: "/repo/apps/cli/dist/bin/xmux.mjs",
          env: { PATH: "/bin" },
        },
        configPath: undefined,
      }),
    );

    expect(spec).toEqual({
      command: "/usr/bin/node",
      args: ["/repo/apps/cli/dist/bin/xmux.mjs", "server", "run", "--foreground"],
      env: { PATH: "/bin" },
      detached: true,
      stdio: "ignore",
    });
  });

  it("rejects TypeScript entrypoints", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        buildServerRunSpawnSpec({
          process: {
            executablePath: "/usr/bin/node",
            entrypointPath: "/repo/apps/cli/bin/xmux.ts",
            env: { PATH: "/bin" },
          },
          configPath: undefined,
        }),
      ),
    );

    expect(error._tag).toBe("CliSpawnError");
    expect(error.message).toBe("Cannot auto-start xmux server from a TypeScript CLI entrypoint.");
  });

  it("includes config paths in spawn specs", async () => {
    const configPath = await Effect.runPromise(
      parseConfigPathOption(Option.some("/tmp/xmux.jsonc")),
    );
    const spec = await Effect.runPromise(
      buildServerRunSpawnSpec({
        process: {
          executablePath: "/usr/bin/xmux",
          entrypointPath: undefined,
          env: {},
        },
        configPath,
      }),
    );

    expect(spec.args).toEqual(["server", "run", "--foreground", "--config", "/tmp/xmux.jsonc"]);
  });

  it("catches missing command spawn failures", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        spawnDetached({
          command: "/definitely/missing/xmux-command",
          args: ["server", "run", "--foreground"],
          env: {},
          detached: true,
          stdio: "ignore",
        }),
      ),
    );

    expect(error._tag).toBe("CliSpawnError");
  });
});

describe("process wait helpers", () => {
  it("treats unreachable as success while waiting for shutdown", async () => {
    const program = Effect.gen(function* () {
      const timeoutMs = yield* parseTimeoutMs(5);
      const intervalMs = yield* parsePollIntervalMs(1);
      yield* waitForUnreachable({
        check: new CliServerUnreachable({ message: "unreachable" }),
        timeoutMs,
        intervalMs,
      });
    });

    await Effect.runPromise(program);
  });

  it("times out while waiting for readiness", async () => {
    const program = Effect.gen(function* () {
      const timeoutMs = yield* parseTimeoutMs(1);
      const intervalMs = yield* parsePollIntervalMs(1);
      return yield* Effect.flip(
        waitForReachable({
          check: Effect.succeed(false),
          timeoutMs,
          intervalMs,
        }),
      );
    });

    const error = await Effect.runPromise(program);
    expect(error._tag).toBe("CliWaitTimeout");
    expect(error.operation).toBe("start");
  });
});
