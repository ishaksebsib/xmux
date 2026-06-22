import { join } from "node:path";
import type { ServerRuntimePaths } from "../../src/server-control/paths";
import { createScopeId } from "../../src/server-control/paths";
import {
  configPathFromString,
  databasePathFromString,
  logDirFromString,
  manifestPathFromString,
  runtimeDirFromString,
  startupLockPathFromString,
  stateDirFromString,
  unixSocketPathFromString,
} from "../../src/contracts/primitives";

export const makeTestPaths = (input: {
  readonly root: string;
  readonly configPath?: string;
  readonly scopeId?: string;
  readonly socketPath?: string;
}): ServerRuntimePaths => ({
  configPath: configPathFromString(input.configPath ?? join(input.root, "config.jsonc")),
  stateDir: stateDirFromString(join(input.root, "state")),
  runtimeDir: runtimeDirFromString(join(input.root, "runtime")),
  logDir: logDirFromString(join(input.root, "logs")),
  dbPath: databasePathFromString(join(input.root, "state", "server.db")),
  manifestPath: manifestPathFromString(join(input.root, "server.json")),
  startupLockPath: startupLockPathFromString(join(input.root, "startup.lock")),
  controlEndpoint: {
    kind: "unix-socket",
    path: unixSocketPathFromString(input.socketPath ?? join(input.root, "runtime", "server.sock")),
  },
  scopeId: createScopeId({
    configPath: input.configPath ?? join(input.root, "config.jsonc"),
    stateDir: join(input.root, "state"),
  }),
});
