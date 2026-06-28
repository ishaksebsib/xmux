import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { CliServerUnreachable } from "../src/domain/errors";
import { parseConfigPathOption, parsePollIntervalMs, parseTimeoutMs } from "../src/domain/input";
import { resolveCliEntrypointPath, spawnDetached } from "../src/platform/node/process-spawner";
import { buildServerRunArgs, buildServerRunSpawnSpec } from "../src/process/spawn";
import { waitForReachable, waitForUnreachable } from "../src/process/wait";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

describe("process planning", () => {
  it("builds foreground server arguments", () => {
    expect(buildServerRunArgs(undefined)).toEqual(["server", "run", "--foreground"]);
  });

  it.effect("builds built executable spawn specs", () =>
    Effect.gen(function* () {
      const spec = yield* buildServerRunSpawnSpec({
        currentProcess: {
          executablePath: "/usr/bin/xmux",
          entrypointPath: undefined,
          env: { PATH: "/bin" },
        },
        configPath: undefined,
      });

      expect(spec).toEqual({
        command: "/usr/bin/xmux",
        args: ["server", "run", "--foreground"],
        env: { PATH: "/bin" },
        detached: true,
        stdio: "ignore",
      });
    }),
  );

  it.effect("builds node script .mjs spawn specs", () =>
    Effect.gen(function* () {
      const spec = yield* buildServerRunSpawnSpec({
        currentProcess: {
          executablePath: "/usr/bin/node",
          entrypointPath: "/repo/apps/cli/dist/bin/xmux.mjs",
          env: { PATH: "/bin" },
        },
        configPath: undefined,
      });

      expect(spec).toEqual({
        command: "/usr/bin/node",
        args: ["/repo/apps/cli/dist/bin/xmux.mjs", "server", "run", "--foreground"],
        env: { PATH: "/bin" },
        detached: true,
        stdio: "ignore",
      });
    }),
  );

  posixIt("resolves extensionless installed bin symlinks before spawn planning", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-cli-bin-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      const target = join(root, "xmux.mjs");
      const link = join(root, "xmux");
      yield* Effect.promise(() => writeFile(target, "#!/usr/bin/env node\n"));
      yield* Effect.promise(() => symlink(target, link));

      const resolved = resolveCliEntrypointPath(link);
      const canonicalTarget = realpathSync.native(target);
      const spec = yield* buildServerRunSpawnSpec({
        currentProcess: {
          executablePath: "/usr/bin/node",
          entrypointPath: resolved,
          env: { PATH: "/bin" },
        },
        configPath: undefined,
      });

      expect(resolved).toBe(canonicalTarget);
      expect(spec).toEqual({
        command: "/usr/bin/node",
        args: [canonicalTarget, "server", "run", "--foreground"],
        env: { PATH: "/bin" },
        detached: true,
        stdio: "ignore",
      });
    }),
  );

  it("falls back to the original entrypoint path when realpath fails", () => {
    const missing = join(tmpdir(), `xmux-missing-${process.pid}-${Date.now()}`);
    expect(resolveCliEntrypointPath(missing)).toBe(missing);
  });

  it.effect("rejects TypeScript entrypoints", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        buildServerRunSpawnSpec({
          currentProcess: {
            executablePath: "/usr/bin/node",
            entrypointPath: "/repo/apps/cli/bin/xmux.ts",
            env: { PATH: "/bin" },
          },
          configPath: undefined,
        }),
      );

      expect(error._tag).toBe("CliSpawnError");
      expect(error.message).toContain("TypeScript CLI entrypoint");
      expect(error.message).toContain("Build the CLI");
      expect(error.message).toContain("xmux server run --foreground");
    }),
  );

  it.effect("includes config paths in spawn specs", () =>
    Effect.gen(function* () {
      const configPath = yield* parseConfigPathOption(Option.some("/tmp/xmux.jsonc"));
      const spec = yield* buildServerRunSpawnSpec({
        currentProcess: {
          executablePath: "/usr/bin/xmux",
          entrypointPath: undefined,
          env: {},
        },
        configPath,
      });

      expect(spec.args).toEqual(["server", "run", "--foreground", "--config", "/tmp/xmux.jsonc"]);
    }),
  );

  it.live("catches missing command spawn failures", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        spawnDetached({
          command: "/definitely/missing/xmux-command",
          args: ["server", "run", "--foreground"],
          env: {},
          detached: true,
          stdio: "ignore",
        }),
      );

      expect(error._tag).toBe("CliSpawnError");
    }),
  );
});

describe("process wait helpers", () => {
  it.live("treats unreachable as success while waiting for shutdown", () =>
    Effect.gen(function* () {
      const timeoutMs = yield* parseTimeoutMs(5);
      const intervalMs = yield* parsePollIntervalMs(1);
      yield* waitForUnreachable({
        check: new CliServerUnreachable({ message: "unreachable" }),
        timeoutMs,
        intervalMs,
      });
    }),
  );

  it.live("times out while waiting for readiness", () =>
    Effect.gen(function* () {
      const timeoutMs = yield* parseTimeoutMs(1);
      const intervalMs = yield* parsePollIntervalMs(1);
      const error = yield* Effect.flip(
        waitForReachable({
          check: Effect.succeed(false),
          timeoutMs,
          intervalMs,
        }),
      );

      expect(error._tag).toBe("CliWaitTimeout");
      expect(error.operation).toBe("start");
    }),
  );
});
