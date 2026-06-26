import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ControlClient } from "../src/control/client";
import { CliResolvedServerPaths, CliRunningServer } from "../src/domain/discovery";
import { parseTailCount } from "../src/domain/input";

const runningServer = (socketPath: string): CliRunningServer => {
  const paths = new CliResolvedServerPaths({
    configPath: join(tmpdir(), "xmux-config.jsonc"),
    stateDir: join(tmpdir(), "xmux-state"),
    runtimeDir: join(tmpdir(), "xmux-runtime"),
    logDir: join(tmpdir(), "xmux-logs"),
    dbPath: join(tmpdir(), "xmux-state", "xmux.db"),
    manifestPath: join(tmpdir(), "xmux-state", "server.json"),
    startupLockPath: join(tmpdir(), "xmux-runtime", "startup.lock"),
    socketPath,
    scopeId: "test-scope",
  });

  return new CliRunningServer({
    _tag: "Running",
    paths,
    manifestPath: paths.manifestPath,
    socketPath,
    pid: process.pid,
    pidAlive: true,
    sessionId: "test-session",
  });
};

describe("ControlClient", () => {
  it("maps request-time socket failures to CliServerUnreachable", async () => {
    const missingSocket = join(tmpdir(), `xmux-missing-${process.pid}-${Date.now()}.sock`);
    const program = Effect.gen(function* () {
      const client = yield* ControlClient;
      return yield* Effect.flip(client.status(runningServer(missingSocket)));
    }).pipe(Effect.provide(ControlClient.layer));

    const error = await Effect.runPromise(program);
    expect(error._tag).toBe("CliServerUnreachable");
    if (error._tag === "CliServerUnreachable") {
      expect(error.operation).toBe("status");
      expect(error.socketPath).toBe(missingSocket);
    }
  });

  it("does not reach the logs API when tail parsing fails", async () => {
    let reachedClientApi = false;
    const program = Effect.gen(function* () {
      const tail = yield* parseTailCount(0);
      reachedClientApi = true;
      const client = yield* ControlClient;
      return yield* client.logs(runningServer("/tmp/unreachable.sock"), tail);
    }).pipe(Effect.provide(ControlClient.layer));

    await Effect.runPromise(Effect.flip(program));
    expect(reachedClientApi).toBe(false);
  });
});
