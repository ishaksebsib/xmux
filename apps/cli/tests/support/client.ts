import { join } from "node:path";
import { tmpdir } from "node:os";
import { CliResolvedServerPaths, CliRunningServer } from "../../src/domain/discovery";

export const runningServer = (socketPath: string): CliRunningServer => {
  const root = join(tmpdir(), "xmux-cli-client-test");
  const paths = new CliResolvedServerPaths({
    configPath: join(root, "xmux-config.jsonc"),
    stateDir: join(root, "state"),
    runtimeDir: join(root, "runtime"),
    logDir: join(root, "logs"),
    dbPath: join(root, "state", "xmux.db"),
    manifestPath: join(root, "state", "server.json"),
    startupLockPath: join(root, "runtime", "startup.lock"),
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
