import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Scope } from "effect";

export interface CliSandbox {
  readonly root: string;
  readonly configPath: string;
  readonly writeConfig: (content: string) => Effect.Effect<void>;
  readonly writeText: (path: string, content: string) => Effect.Effect<void>;
  readonly exists: (path: string) => Effect.Effect<boolean>;
}

export const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

export const writeText = (path: string, content: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  });

export const makeCliSandbox: Effect.Effect<CliSandbox, never, Scope.Scope> = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-cli-test-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })).pipe(Effect.ignore),
).pipe(
  Effect.map((root) => ({
    root,
    configPath: join(root, "config.jsonc"),
    writeConfig: (content: string) => writeText(join(root, "config.jsonc"), content),
    writeText,
    exists: pathExists,
  })),
);

export const minimalConfig = (): string =>
  '{ "xmux": { "workspace": { "defaultDir": "./workspace" } } }\n';
