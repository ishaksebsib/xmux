import { join } from "node:path";
import { Effect } from "effect";

interface EnvSnapshot {
  readonly values: ReadonlyMap<string, string | undefined>;
}

const restoreEnvVar = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

export const withEnvVars = <A, E, R>(
  values: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync((): EnvSnapshot => {
      const snapshot = new Map<string, string | undefined>();
      for (const [name, value] of Object.entries(values)) {
        snapshot.set(name, process.env[name]);
        restoreEnvVar(name, value);
      }
      return { values: snapshot };
    }),
    () => effect,
    (snapshot) =>
      Effect.sync(() => {
        for (const [name, value] of snapshot.values) {
          restoreEnvVar(name, value);
        }
      }),
  );

export const cliRuntimeEnvForRoot = (root: string): Record<string, string> => ({
  HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "xdg-config"),
  XDG_STATE_HOME: join(root, "xdg-state"),
  XDG_RUNTIME_DIR: join(root, "xdg-runtime"),
});
