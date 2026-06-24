import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { Effect, Layer } from "effect";
import { applyDatabasePragmas } from "./pragmas";
import type { AppliedMigration } from "./migrations";
import { runDatabaseMigrations } from "./migrations";
import { DatabaseStartupError } from "./errors";
import { RuntimePaths, type ServerRuntimePaths } from "../server-control/paths";

export interface DatabaseStartupResult {
  readonly appliedMigrations: ReadonlyArray<AppliedMigration>;
}

/** libSQL local file URL. RuntimePaths already guarantees an absolute DB path. */
export const libsqlFileUrlFromPath = (path: string): string => `file:${path}`;

const makeRawDatabaseSqlLayer = (paths: ServerRuntimePaths) =>
  LibsqlClient.layer({
    url: libsqlFileUrlFromPath(paths.dbPath),
    concurrency: 1,
    spanAttributes: {
      "db.namespace": "xmux-server",
      "db.path": paths.dbPath,
    },
  });

/** Effect SQL/libSQL layer for the server-owned local SQLite database. */
export const makeDatabaseSqlLayer = (paths: ServerRuntimePaths) => {
  const sqlLayer = makeRawDatabaseSqlLayer(paths);
  return Layer.provideMerge(Layer.effectDiscard(applyDatabasePragmas(paths.dbPath)), sqlLayer);
};

const openDatabaseContext = Effect.fn("server.db.open")(function* (paths: ServerRuntimePaths) {
  const scope = yield* Effect.scope;
  yield* Effect.logInfo("opening database", { path: paths.dbPath });

  return yield* Layer.buildWithScope(makeDatabaseSqlLayer(paths), scope).pipe(
    Effect.catchDefect((cause) =>
      Effect.fail(
        DatabaseStartupError.make({
          path: paths.dbPath,
          message: `Failed to open database: ${paths.dbPath}`,
          cause,
        }),
      ),
    ),
  );
});

/** Open the DB with per-connection PRAGMAs and run startup migrations in the current scope. */
export const initializeDatabase = Effect.fn("server.db.initialize")(function* () {
  const paths = yield* RuntimePaths;
  const sqlContext = yield* openDatabaseContext(paths);

  const appliedMigrations = yield* runDatabaseMigrations(paths.dbPath).pipe(
    Effect.provide(sqlContext),
  );

  return { appliedMigrations } satisfies DatabaseStartupResult;
});
