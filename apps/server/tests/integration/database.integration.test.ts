import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { OrchestratorStore } from "../../src/db/orchestrator-store";
import { RuntimePaths } from "../../src/server-control/paths";
import { makeTestPaths } from "../support/paths";

const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

const makeSandbox = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-server-store-integration-"));
    const paths = makeTestPaths({ root });
    await mkdir(paths.stateDir, { recursive: true });
    return { root, paths };
  }),
  ({ root }) =>
    Effect.promise(() => rm(root, { recursive: true, force: true })).pipe(Effect.ignore),
);

describeIntegration("server SQLite store wiring", () => {
  it.effect(
    "constructs the reusable store from RuntimePaths and delegates lifecycle ownership",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox;
        const store = yield* Effect.gen(function* () {
          return yield* OrchestratorStore;
        }).pipe(
          Effect.provide(
            Layer.provide(OrchestratorStore.layer, Layer.succeed(RuntimePaths)(sandbox.paths)),
          ),
        );
        const initialized = yield* Effect.promise(() => store.initialize());
        assert.isTrue(initialized.isOk());
        const workspace = {
          thread: { chatId: "telegram", threadId: "thread-1" },
          cwd: "/repo",
          createdAt: "2026-05-08T10:00:00.000Z",
          updatedAt: "2026-05-08T10:00:00.000Z",
        };
        assert.isTrue((yield* Effect.promise(() => store.workspaces.set(workspace))).isOk());
        assert.isTrue((yield* Effect.promise(() => store.close())).isOk());
      }),
  );
});
