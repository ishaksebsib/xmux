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
  ORCHESTRATOR_SESSION_TABLE,
  ORCHESTRATOR_STORE_MIGRATION,
  THREAD_BINDING_SESSION_INDEX,
  THREAD_BINDING_TABLE,
  THREAD_WORKSPACE_TABLE,
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
      VALUES (
        ${DATABASE_NAMESPACE_KEY},
        ${DATABASE_NAMESPACE_VALUE},
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `.withoutTransform;
  },
);

const orchestratorStoreMigration: Effect.Effect<void, unknown, SqlClient.SqlClient> = Effect.gen(
  function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS ${sql(ORCHESTRATOR_SESSION_TABLE)} (
        harness_id TEXT NOT NULL CHECK (length(harness_id) > 0),
        session_id TEXT NOT NULL CHECK (length(session_id) > 0),
        origin_chat_id TEXT NOT NULL CHECK (length(origin_chat_id) > 0),
        origin_thread_id TEXT NOT NULL CHECK (length(origin_thread_id) > 0),
        requester_user_id TEXT NOT NULL CHECK (length(requester_user_id) > 0),
        requester_display_name TEXT NULL,
        cwd TEXT NOT NULL CHECK (length(cwd) > 0),
        title TEXT NULL,
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (harness_id, session_id)
      )
    `.withoutTransform;

    yield* sql`
      CREATE TABLE IF NOT EXISTS ${sql(THREAD_BINDING_TABLE)} (
        chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
        thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
        harness_id TEXT NOT NULL CHECK (length(harness_id) > 0),
        session_id TEXT NOT NULL CHECK (length(session_id) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        PRIMARY KEY (chat_id, thread_id),
        FOREIGN KEY (harness_id, session_id)
          REFERENCES ${sql(ORCHESTRATOR_SESSION_TABLE)}(harness_id, session_id)
          ON DELETE CASCADE
      )
    `.withoutTransform;

    yield* sql`
      CREATE INDEX IF NOT EXISTS ${sql(THREAD_BINDING_SESSION_INDEX)}
        ON ${sql(THREAD_BINDING_TABLE)} (harness_id, session_id)
    `.withoutTransform;

    yield* sql`
      CREATE TABLE IF NOT EXISTS ${sql(THREAD_WORKSPACE_TABLE)} (
        chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
        thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
        cwd TEXT NOT NULL CHECK (length(cwd) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (chat_id, thread_id)
      )
    `.withoutTransform;
  },
);

/** Ordered, append-only startup migration registry. */
export const databaseMigrations = LibsqlMigrator.fromRecord({
  [DATABASE_FOUNDATION_MIGRATION]: databaseFoundationMigration,
  [ORCHESTRATOR_STORE_MIGRATION]: orchestratorStoreMigration,
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

/** Run startup migrations using the stable xmux migration ledger table. */
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
