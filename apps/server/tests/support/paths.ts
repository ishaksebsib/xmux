import { join } from "node:path";
import type { ServerRuntimePaths } from "../../src/server-control/paths";
import { resolvedPathFromString } from "../../src/server-control/paths";

export const makeTestPaths = (input: {
  readonly root: string;
  readonly configPath?: string;
  readonly scopeId?: string;
  readonly socketPath?: string;
}): ServerRuntimePaths => ({
  configPath: resolvedPathFromString(input.configPath ?? join(input.root, "config.jsonc")),
  stateDir: resolvedPathFromString(join(input.root, "state")),
  runtimeDir: resolvedPathFromString(join(input.root, "runtime")),
  logDir: resolvedPathFromString(join(input.root, "logs")),
  dbPath: resolvedPathFromString(join(input.root, "state", "server.db")),
  manifestPath: resolvedPathFromString(join(input.root, "server.json")),
  startupLockPath: resolvedPathFromString(join(input.root, "startup.lock")),
  controlEndpoint: {
    kind: "unix-socket",
    path: resolvedPathFromString(input.socketPath ?? join(input.root, "runtime", "server.sock")),
  },
  scopeId: input.scopeId ?? "testscope",
});
