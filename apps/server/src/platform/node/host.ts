import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { Effect, Layer } from "effect";
import { HostRuntime } from "../host";

/** PID liveness is a stale-file hint, never sole ownership proof. */
export const isPidAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) {
      if (cause.code === "ESRCH") return false;
      if (cause.code === "EPERM") return true;
    }
    return false;
  }
};

/** Node implementation of host process/environment services. */
export const nodeHostRuntimeLayer = Layer.succeed(HostRuntime)({
  platform: process.platform,
  homeDir: homedir(),
  pid: process.pid,
  executablePath: process.argv[1] ?? process.execPath,
  getEnv: (name) => process.env[name],
  randomUuid: Effect.fn("HostRuntime.randomUuid")(function* () {
    return yield* Effect.sync(() => randomUUID());
  }),
  isPidAlive: Effect.fn("HostRuntime.isPidAlive")(function* (pid: number) {
    return yield* Effect.sync(() => isPidAlive(pid));
  }),
  emitWarning: Effect.fn("HostRuntime.emitWarning")(function* (message: string) {
    yield* Effect.sync(() => process.emitWarning(message));
  }),
});
