import * as LibsqlMigrator from "@effect/sql-libsql/LibsqlMigrator";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DatabaseMigrationError } from "./errors";
import {
  DATABASE_FOUNDATION_MIGRATION,
  DATABASE_NAMESPACE_KEY,
  DATABASE_NAMESPACE_VALUE,
  DB_METADATA_TABLE,
  MIGRATIONS_TABLE,
} from "./schema";

export type AppliedMigration = readonly [id: number, name: string];

const databaseFoundationMigration: Effect.Effect<void, unknown, SqlClient.SqlClient> = Effect.gen(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${sql(DB_METADATA_TABLE)} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.withoutTransform;
    yield* sql`
      INSERT INTO ${sql(DB_METADATA_TABLE)} (key, value, updated_at)
      VALUES (${DATABASE_NAMESPACE_KEY}, ${DATABASE_NAMESPACE_VALUE}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `.withoutTransform;
  },
);

export const databaseMigrations = LibsqlMigrator.fromRecord({
  [DATABASE_FOUNDATION_MIGRATION]: databaseFoundationMigration,
});

export interface RunDatabaseMigrationsInput<R = never> {
  readonly path: string;
  readonly loader: LibsqlMigrator.Loader<R>;
}

const mapMigrationFailure = (path: string, cause: unknown): DatabaseMigrationError =>
  DatabaseMigrationError.make({
    path,
    message: `Failed to run database migrations for ${path}`,
    cause,
  });

export const formatAppliedMigrationId = ([id, name]: AppliedMigration): string =>
  `${String(id).padStart(4, "0")}_${name}`;

export const runDatabaseMigrationsWithLoader = Effect.fn("server.db.runMigrationsWithLoader")(
  function* <R>(input: RunDatabaseMigrationsInput<R>) {
    yield* Effect.logInfo("running database migrations", {
      path: input.path,
      migrationsTable: MIGRATIONS_TABLE,
    });
    const applied = yield* LibsqlMigrator.run({
      loader: input.loader,
      table: MIGRATIONS_TABLE,
    }).pipe(
      Effect.mapError((cause) => mapMigrationFailure(input.path, cause)),
      Effect.catchDefect((cause) => Effect.fail(mapMigrationFailure(input.path, cause))),
    );
    yield* Effect.logInfo("database migrations complete", {
      path: input.path,
      migrationsTable: MIGRATIONS_TABLE,
      appliedMigrationCount: applied.length,
      appliedMigrations: applied.map(formatAppliedMigrationId),
    });
    return applied;
  },
);

export const runDatabaseMigrations = Effect.fn("server.db.runMigrations")(function* (path: string) {
  return yield* runDatabaseMigrationsWithLoader({ path, loader: databaseMigrations });
});
