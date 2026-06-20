import { join } from "node:path";
import type { ServerRuntimePaths } from "../../src/server-control/paths";

export const makeTestPaths = (input: {
  readonly root: string;
  readonly configPath?: string;
  readonly scopeId?: string;
  readonly socketPath?: string;
}): ServerRuntimePaths => ({
  configPath: input.configPath ?? join(input.root, "config.jsonc"),
  stateDir: join(input.root, "state"),
  runtimeDir: join(input.root, "runtime"),
  logDir: join(input.root, "logs"),
  dbPath: join(input.root, "state", "server.db"),
  manifestPath: join(input.root, "server.json"),
  startupLockPath: join(input.root, "startup.lock"),
  controlEndpoint: {
    kind: "unix-socket",
    path: input.socketPath ?? join(input.root, "runtime", "server.sock"),
  },
  scopeId: input.scopeId ?? "testscope",
});
