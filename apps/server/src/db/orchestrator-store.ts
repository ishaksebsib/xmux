import type { Store } from "@xmux/orchestrator";
import { createSqliteStore } from "@xmux/store-sqlite";
import { Context, Effect, Layer } from "effect";
import { RuntimePaths } from "../server-control/paths";

/** Server-local injection key for the plain orchestrator store contract. */
export class OrchestratorStore extends Context.Service<OrchestratorStore, Store>()(
  "@xmux/server/OrchestratorStore",
) {
  static readonly layer = Layer.effect(
    OrchestratorStore,
    Effect.gen(function* () {
      const paths = yield* RuntimePaths;
      return createSqliteStore({ path: paths.dbPath });
    }),
  );
}
