import { assert } from "@effect/vitest";
import { Effect } from "effect";
import type { ServerRuntimePaths } from "../../src/server-control/paths";
import { exists } from "./wait";

export const assertNoSecret = (text: string, secret: string): Effect.Effect<void> =>
  Effect.sync(() => assert.notInclude(text, secret));

export const assertServerPublished = (paths: ServerRuntimePaths): Effect.Effect<void> =>
  Effect.gen(function* () {
    assert.isTrue(yield* exists(paths.manifestPath), "manifest should exist");
    assert.isTrue(yield* exists(paths.controlEndpoint.path), "socket should exist");
    assert.isFalse(yield* exists(paths.startupLockPath), "startup lock should be removed");
  });

export const assertRuntimeFilesCleaned = (paths: ServerRuntimePaths): Effect.Effect<void> =>
  Effect.gen(function* () {
    assert.isFalse(yield* exists(paths.manifestPath), "manifest should be removed");
    assert.isFalse(yield* exists(paths.controlEndpoint.path), "socket should be removed");
    assert.isFalse(yield* exists(paths.startupLockPath), "startup lock should be removed");
  });
