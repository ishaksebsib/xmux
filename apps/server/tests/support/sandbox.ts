import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Scope } from "effect";
import type { ServerRuntimePaths } from "../../src/runtime-state/paths";
import { writeConfig as writeConfigFile } from "./config";
import { makeTestPaths } from "./paths";

export interface ServerTestSandbox {
  readonly root: string;
  readonly paths: ServerRuntimePaths;
  readonly writeConfig: (content: string) => Effect.Effect<void, unknown>;
}

export const makeSandbox: Effect.Effect<ServerTestSandbox, never, Scope.Scope> =
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-server-"))).pipe(
      Effect.map((root) => {
        const paths = makeTestPaths({ root });
        return {
          root,
          paths,
          writeConfig: (content: string) => writeConfigFile(paths.configPath, content),
        };
      }),
    ),
    (sandbox) =>
      Effect.promise(() => rm(sandbox.root, { recursive: true, force: true })).pipe(Effect.ignore),
  );
