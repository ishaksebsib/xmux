import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as LibsqlMigrator from "@effect/sql-libsql/LibsqlMigrator";
import { assert, describe, it } from "@effect/vitest";
import {
  StoreConflictError,
  StoreNotFoundError,
  StoreOperationError,
  type ChatThreadRef,
  type Result as StoreResult,
  type SessionRecord,
  type Store,
  type StoreOperation,
  type ThreadBinding,
  type ThreadWorkspace,
} from "@xmux/orchestrator";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { databasePathFromString } from "../../src/contracts/primitives";
import { initializeDatabase, makeDatabaseSqlLayer } from "../../src/db/layer";
import { formatAppliedMigrationId, runDatabaseMigrationsWithLoader } from "../../src/db/migrations";
import { OrchestratorStore } from "../../src/db/orchestrator-store";
import { SQLITE_BUSY_TIMEOUT_MS } from "../../src/db/pragmas";
import {
  DATABASE_NAMESPACE_KEY,
  DATABASE_NAMESPACE_VALUE,
  DB_METADATA_TABLE,
  MIGRATIONS_TABLE,
  ORCHESTRATOR_SESSION_TABLE,
  THREAD_BINDING_SESSION_INDEX,
  THREAD_BINDING_TABLE,
  THREAD_WORKSPACE_TABLE,
} from "../../src/db/schema";
import { RuntimePaths, type ServerRuntimePaths } from "../../src/server-control/paths";
import { makeTestPaths } from "../support/paths";

const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

const now = "2026-05-08T10:00:00.000Z";
const later = "2026-05-08T10:05:00.000Z";

const session = {
  ref: {
    harnessId: "opencode",
    sessionId: "session-1",
  },
  origin: {
    chatId: "telegram",
    threadId: "thread-1",
  },
  requester: {
    userId: "user-1",
    displayName: "Ishak",
  },
  cwd: "/repo",
  title: "Fix bug",
  createdAt: now,
  updatedAt: now,
} satisfies SessionRecord;

const otherSession = {
  ...session,
  ref: {
    harnessId: "opencode",
    sessionId: "session-2",
  },
  origin: {
    chatId: "telegram",
    threadId: "thread-2",
  },
  title: "Other task",
} satisfies SessionRecord;

const thirdSession = {
  ref: {
    harnessId: "pi",
    sessionId: "session-3",
  },
  origin: {
    chatId: "discord",
    threadId: "thread-3",
  },
  requester: {
    userId: "user-3",
  },
  cwd: "/repo",
  createdAt: now,
  updatedAt: now,
} satisfies SessionRecord;

const workspace = {
  thread: session.origin,
  cwd: "/repo",
  createdAt: now,
  updatedAt: now,
} satisfies ThreadWorkspace;

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-server-db-integration-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const makePreparedPaths = Effect.gen(function* () {
  const root = yield* makeTempRoot;
  const paths = makeTestPaths({ root });
  yield* Effect.promise(() => mkdir(paths.stateDir, { recursive: true }));
  return paths;
});

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

const runDbStartup = (paths: ServerRuntimePaths) =>
  Effect.scoped(initializeDatabase().pipe(Effect.provide(Layer.succeed(RuntimePaths)(paths))));

const makeInitializedStoreLayer = (paths: ServerRuntimePaths) =>
  Layer.provideMerge(
    OrchestratorStore.layer,
    Layer.mergeAll(Layer.succeed(RuntimePaths)(paths), makeDatabaseSqlLayer(paths)),
  );

const withInitializedStore = <A, E>(
  paths: ServerRuntimePaths,
  use: (store: Store) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* initializeDatabase();
      const store = yield* OrchestratorStore;
      return yield* use(store);
    }).pipe(Effect.provide(makeInitializedStoreLayer(paths))),
  );

const invalidDirectoryDbPath = (paths: ServerRuntimePaths): ServerRuntimePaths => ({
  ...paths,
  dbPath: databasePathFromString(paths.stateDir),
});

type TableNameRow = { readonly name: string };
type MigrationLedgerRow = { readonly migration_id: number; readonly name: string };
type MetadataRow = { readonly key: string; readonly value: string };
type CountRow = { readonly count: number };
type TableInfoRow = {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
};
type ForeignKeyListRow = {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string;
  readonly on_update: string;
  readonly on_delete: string;
  readonly match: string;
};
type IndexListRow = {
  readonly seq: number;
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
};
type IndexInfoRow = { readonly seqno: number; readonly cid: number; readonly name: string };
type ForeignKeysPragmaRow = { readonly foreign_keys: number };
type JournalModePragmaRow = { readonly journal_mode: string };
type BusyTimeoutPragmaRow = { readonly timeout: number };
type PragmaSnapshot = {
  readonly foreignKeys: number | undefined;
  readonly journalMode: string | undefined;
  readonly busyTimeoutMs: number | undefined;
};

const readTableNames = (paths: ServerRuntimePaths): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<TableNameRow>`
        SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
      `.withoutTransform;
      return rows.map((row) => row.name);
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readMigrationLedger = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<MigrationLedgerRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MigrationLedgerRow>`
        SELECT migration_id, name FROM ${sql(MIGRATIONS_TABLE)} ORDER BY migration_id
      `.withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readMigrationLedgerIfPresent = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<MigrationLedgerRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const tables = yield* sql<TableNameRow>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${MIGRATIONS_TABLE}
      `.withoutTransform;
      if (tables.length === 0) {
        return [];
      }
      return yield* sql<MigrationLedgerRow>`
        SELECT migration_id, name FROM ${sql(MIGRATIONS_TABLE)} ORDER BY migration_id
      `.withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readMetadataRows = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<MetadataRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MetadataRow>`
        SELECT key, value FROM ${sql(DB_METADATA_TABLE)} ORDER BY key
      `.withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readTableInfo = (
  table:
    | typeof ORCHESTRATOR_SESSION_TABLE
    | typeof THREAD_BINDING_TABLE
    | typeof THREAD_WORKSPACE_TABLE,
): Effect.Effect<ReadonlyArray<TableInfoRow>, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.unsafe<TableInfoRow>(`PRAGMA table_info(${table})`).withoutTransform;
  });

const readThreadBindingForeignKeys: Effect.Effect<
  ReadonlyArray<ForeignKeyListRow>,
  unknown,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.unsafe<ForeignKeyListRow>(`PRAGMA foreign_key_list(${THREAD_BINDING_TABLE})`)
    .withoutTransform;
});

const readThreadBindingIndexes: Effect.Effect<
  ReadonlyArray<IndexListRow>,
  unknown,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.unsafe<IndexListRow>(`PRAGMA index_list(${THREAD_BINDING_TABLE})`)
    .withoutTransform;
});

const readThreadBindingSessionIndexInfo: Effect.Effect<
  ReadonlyArray<IndexInfoRow>,
  unknown,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.unsafe<IndexInfoRow>(`PRAGMA index_info(${THREAD_BINDING_SESSION_INDEX})`)
    .withoutTransform;
});

const readPragmasOnNewConnection = (
  paths: ServerRuntimePaths,
): Effect.Effect<PragmaSnapshot, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const foreignKeys = yield* sql<ForeignKeysPragmaRow>`PRAGMA foreign_keys`.withoutTransform;
      const journalMode = yield* sql<JournalModePragmaRow>`PRAGMA journal_mode`.withoutTransform;
      const busyTimeout = yield* sql<BusyTimeoutPragmaRow>`PRAGMA busy_timeout`.withoutTransform;

      return {
        foreignKeys: foreignKeys[0]?.foreign_keys,
        journalMode: journalMode[0]?.journal_mode.toLowerCase(),
        busyTimeoutMs: busyTimeout[0]?.timeout,
      } satisfies PragmaSnapshot;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const bindFor = (
  input: {
    readonly thread?: ThreadBinding["thread"];
    readonly sessionRef?: ThreadBinding["sessionRef"];
    readonly createdAt?: string;
  } = {},
): ThreadBinding => ({
  thread: input.thread ?? session.origin,
  sessionRef: input.sessionRef ?? session.ref,
  createdAt: input.createdAt ?? now,
});

const expectOk = <A, E>(result: StoreResult<A, E>, message: string): A => {
  if (result.isErr()) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    assert.fail(`${message}: ${detail}`);
  }
  return result.value;
};

const expectErr = <A, E>(result: StoreResult<A, E>, message: string): E => {
  if (result.isOk()) {
    assert.fail(message);
  }
  return result.error;
};

const expectStoreConflictError = <A, E>(result: StoreResult<A, E>): StoreConflictError => {
  const error = expectErr(result, "expected StoreConflictError");
  if (!StoreConflictError.is(error)) {
    assert.fail("expected StoreConflictError");
  }
  return error;
};

const expectStoreNotFoundError = <A, E>(result: StoreResult<A, E>): StoreNotFoundError => {
  const error = expectErr(result, "expected StoreNotFoundError");
  if (!StoreNotFoundError.is(error)) {
    assert.fail("expected StoreNotFoundError");
  }
  return error;
};

const expectStoreOperationError = <A, E>(
  result: StoreResult<A, E>,
  expected: { readonly operation: StoreOperation; readonly resource: string },
): StoreOperationError => {
  const error = expectErr(result, "expected StoreOperationError");
  if (!StoreOperationError.is(error)) {
    assert.fail("expected StoreOperationError");
  }
  assert.strictEqual(error.operation, expected.operation);
  assert.strictEqual(error.resource, expected.resource);
  return error;
};

const sameBinding = (left: ThreadBinding, right: ThreadBinding): boolean =>
  left.thread.chatId === right.thread.chatId &&
  left.thread.threadId === right.thread.threadId &&
  left.sessionRef.harnessId === right.sessionRef.harnessId &&
  left.sessionRef.sessionId === right.sessionRef.sessionId &&
  left.createdAt === right.createdAt;

const sameWorkspace = (left: ThreadWorkspace, right: ThreadWorkspace): boolean =>
  left.thread.chatId === right.thread.chatId &&
  left.thread.threadId === right.thread.threadId &&
  left.cwd === right.cwd &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt;

const bindingCountForThread = (
  thread: ChatThreadRef,
): Effect.Effect<number | undefined, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<CountRow>`
      SELECT count(*) AS count
      FROM ${sql(THREAD_BINDING_TABLE)}
      WHERE chat_id = ${thread.chatId}
        AND thread_id = ${thread.threadId}
    `.withoutTransform;
    return rows[0]?.count;
  });

const workspaceCountForThread = (
  thread: ChatThreadRef,
): Effect.Effect<number | undefined, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<CountRow>`
      SELECT count(*) AS count
      FROM ${sql(THREAD_WORKSPACE_TABLE)}
      WHERE chat_id = ${thread.chatId}
        AND thread_id = ${thread.threadId}
    `.withoutTransform;
    return rows[0]?.count;
  });

const bindingCountForSession = (
  ref: SessionRecord["ref"],
): Effect.Effect<number | undefined, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<CountRow>`
      SELECT count(*) AS count
      FROM ${sql(THREAD_BINDING_TABLE)}
      WHERE harness_id = ${ref.harnessId}
        AND session_id = ${ref.sessionId}
    `.withoutTransform;
    return rows[0]?.count;
  });

const insertRawSessionRow = (
  record: SessionRecord,
): Effect.Effect<void, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO ${sql(ORCHESTRATOR_SESSION_TABLE)} (
        harness_id,
        session_id,
        origin_chat_id,
        origin_thread_id,
        requester_user_id,
        requester_display_name,
        cwd,
        title,
        created_at,
        updated_at
      )
      VALUES (
        ${record.ref.harnessId},
        ${record.ref.sessionId},
        ${record.origin.chatId},
        ${record.origin.threadId},
        ${record.requester.userId},
        ${record.requester.displayName ?? null},
        ${record.cwd},
        ${record.title ?? null},
        ${record.createdAt},
        ${record.updatedAt}
      )
    `.withoutTransform;
  });

const assertPragmas = (snapshot: PragmaSnapshot): void => {
  assert.strictEqual(snapshot.foreignKeys, 1);
  assert.strictEqual(snapshot.journalMode, "wal");
  assert.strictEqual(snapshot.busyTimeoutMs, SQLITE_BUSY_TIMEOUT_MS);
};

describeIntegration("server database integration", () => {
  it.effect(
    "fresh database startup creates migration ledger, metadata, and orchestrator tables",
    () =>
      Effect.gen(function* () {
        const paths = yield* makePreparedPaths;
        const result = yield* runDbStartup(paths);

        assert.deepEqual(result.appliedMigrations.map(formatAppliedMigrationId), [
          "0001_database_foundation",
          "0002_orchestrator_store",
        ]);
        assert.isTrue(yield* exists(paths.dbPath));

        const tableNames = yield* readTableNames(paths);
        assert.deepEqual(
          tableNames,
          [
            DB_METADATA_TABLE,
            MIGRATIONS_TABLE,
            ORCHESTRATOR_SESSION_TABLE,
            THREAD_BINDING_TABLE,
            THREAD_WORKSPACE_TABLE,
          ].sort(),
        );

        const ledger = yield* readMigrationLedger(paths);
        assert.deepEqual(
          ledger.map((row) => formatAppliedMigrationId([row.migration_id, row.name])),
          ["0001_database_foundation", "0002_orchestrator_store"],
        );

        assert.deepEqual(yield* readMetadataRows(paths), [
          { key: DATABASE_NAMESPACE_KEY, value: DATABASE_NAMESPACE_VALUE },
        ]);
      }),
  );

  it.effect("existing database startup is idempotent", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      const first = yield* runDbStartup(paths);
      const second = yield* runDbStartup(paths);

      assert.strictEqual(first.appliedMigrations.length, 2);
      assert.strictEqual(second.appliedMigrations.length, 0);
      assert.strictEqual((yield* readMigrationLedger(paths)).length, 2);
      assert.deepEqual(yield* readMetadataRows(paths), [
        { key: DATABASE_NAMESPACE_KEY, value: DATABASE_NAMESPACE_VALUE },
      ]);
    }),
  );

  it.effect("partial migration failure leaves no half-applied migration ledger entry", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;
      const failingLoader = LibsqlMigrator.fromRecord({
        "0001_half_applied": Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            CREATE TABLE half_applied_probe (
              id INTEGER NOT NULL
            )
          `.withoutTransform;
          yield* Effect.fail("boom");
        }),
      });

      const error = yield* Effect.scoped(
        runDatabaseMigrationsWithLoader({ path: paths.dbPath, loader: failingLoader }).pipe(
          Effect.provide(makeDatabaseSqlLayer(paths)),
        ),
      ).pipe(Effect.flip);

      assert.strictEqual(error._tag, "DatabaseMigrationError");
      assert.strictEqual(error.path, paths.dbPath);
      assert.deepEqual(yield* readMigrationLedgerIfPresent(paths), []);
    }),
  );

  it.effect("startup fails clearly when the database path is invalid", () =>
    Effect.gen(function* () {
      const paths = invalidDirectoryDbPath(yield* makePreparedPaths);

      const error = yield* runDbStartup(paths).pipe(Effect.flip);

      assert.strictEqual(error._tag, "DatabaseStartupError");
      assert.strictEqual(error.path, paths.dbPath);
      assert.include(error.message, paths.dbPath);
    }),
  );

  it.effect("SQLite store works through initializeDatabase and OrchestratorStore.layer", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          const created = yield* Effect.promise(() => store.sessions.create(session));
          const fetched = yield* Effect.promise(() => store.sessions.get(session.ref));
          const updated = yield* Effect.promise(() =>
            store.sessions.update(session.ref, { title: "Fix bug quickly", updatedAt: later }),
          );
          const deleted = yield* Effect.promise(() => store.sessions.delete(session.ref));
          const missing = yield* Effect.promise(() => store.sessions.get(session.ref));

          assert.deepEqual(expectOk(created, "expected session create to succeed"), session);
          assert.deepEqual(expectOk(fetched, "expected session lookup to succeed"), session);
          assert.deepEqual(expectOk(updated, "expected session update to succeed"), {
            ...session,
            title: "Fix bug quickly",
            updatedAt: later,
          });
          expectOk(deleted, "expected session delete to succeed");
          assert.isNull(expectOk(missing, "expected missing session lookup to succeed"));

          const recreated = yield* Effect.promise(() => store.sessions.create(session));
          expectOk(recreated, "expected session recreate to succeed");

          const binding = bindFor();
          const bound = yield* Effect.promise(() => store.threadBindings.bind(binding));
          const fetchedBinding = yield* Effect.promise(() =>
            store.threadBindings.get(binding.thread),
          );
          const bindingDeleted = yield* Effect.promise(() =>
            store.threadBindings.delete(binding.thread),
          );
          const missingBinding = yield* Effect.promise(() =>
            store.threadBindings.get(binding.thread),
          );

          expectOk(bound, "expected binding to succeed");
          assert.deepEqual(expectOk(fetchedBinding, "expected binding lookup to succeed"), binding);
          expectOk(bindingDeleted, "expected binding delete to succeed");
          assert.isNull(expectOk(missingBinding, "expected missing binding lookup to succeed"));

          const setWorkspace = yield* Effect.promise(() => store.workspaces.set(workspace));
          const fetchedWorkspace = yield* Effect.promise(() =>
            store.workspaces.get(workspace.thread),
          );
          const workspaceDeleted = yield* Effect.promise(() =>
            store.workspaces.delete(workspace.thread),
          );
          const missingWorkspace = yield* Effect.promise(() =>
            store.workspaces.get(workspace.thread),
          );

          assert.deepEqual(expectOk(setWorkspace, "expected workspace set to succeed"), workspace);
          assert.deepEqual(
            expectOk(fetchedWorkspace, "expected workspace lookup to succeed"),
            workspace,
          );
          expectOk(workspaceDeleted, "expected workspace delete to succeed");
          assert.isNull(expectOk(missingWorkspace, "expected missing workspace lookup to succeed"));
        }),
      );
    }),
  );

  it.effect("store data persists after closing and reopening the database layer", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session create to succeed",
          );
          expectOk(
            yield* Effect.promise(() => store.threadBindings.bind(bindFor())),
            "expected binding to succeed",
          );
          expectOk(
            yield* Effect.promise(() => store.workspaces.set(workspace)),
            "expected workspace set to succeed",
          );
        }),
      );

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          assert.deepEqual(
            expectOk(
              yield* Effect.promise(() => store.sessions.get(session.ref)),
              "expected session lookup to succeed after reopen",
            ),
            session,
          );
          assert.deepEqual(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(session.origin)),
              "expected binding lookup to succeed after reopen",
            ),
            bindFor(),
          );
          assert.deepEqual(
            expectOk(
              yield* Effect.promise(() => store.workspaces.get(workspace.thread)),
              "expected workspace lookup to succeed after reopen",
            ),
            workspace,
          );

          const reopenedPragmas = yield* readPragmasOnNewConnection(paths);
          assert.strictEqual(reopenedPragmas.journalMode, "wal");
        }),
      );
    }),
  );

  it.effect("session deletion removes bindings and remains idempotent without FK enforcement", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;
      const otherThread = { chatId: "telegram", threadId: "thread-2" };

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session create to succeed",
          );
          expectOk(
            yield* Effect.promise(() => store.threadBindings.bind(bindFor())),
            "expected binding to succeed",
          );
          expectOk(
            yield* Effect.promise(() =>
              store.threadBindings.bind(bindFor({ thread: otherThread })),
            ),
            "expected second binding to succeed",
          );

          const sql = yield* SqlClient.SqlClient;
          yield* sql.unsafe("PRAGMA foreign_keys = OFF").withoutTransform;

          expectOk(
            yield* Effect.promise(() => store.sessions.delete(session.ref)),
            "expected session delete to succeed",
          );
          expectOk(
            yield* Effect.promise(() => store.sessions.delete(session.ref)),
            "expected missing session delete to be idempotent",
          );

          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(session.origin)),
              "expected first binding lookup to succeed",
            ),
          );
          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(otherThread)),
              "expected second binding lookup to succeed",
            ),
          );
          assert.strictEqual(yield* bindingCountForSession(session.ref), 0);
        }),
      );
    }),
  );

  it.effect("foreign-key integrity rejects dangling bindings and cascades session deletes", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          const missing = yield* Effect.promise(() => store.threadBindings.bind(bindFor()));
          const missingError = expectStoreNotFoundError(missing);
          assert.strictEqual(missingError.resource, "session");

          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session create to succeed",
          );
          expectOk(
            yield* Effect.promise(() => store.sessions.create(otherSession)),
            "expected second session create to succeed",
          );

          expectOk(
            yield* Effect.promise(() => store.threadBindings.bind(bindFor())),
            "expected binding to existing session to succeed",
          );
          const replacement = bindFor({ sessionRef: otherSession.ref, createdAt: later });
          expectOk(
            yield* Effect.promise(() => store.threadBindings.bind(replacement)),
            "expected rebinding to existing session to succeed",
          );
          assert.deepEqual(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(session.origin)),
              "expected rebound lookup to succeed",
            ),
            replacement,
          );

          expectOk(
            yield* Effect.promise(() => store.sessions.delete(otherSession.ref)),
            "expected session delete to succeed",
          );
          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(session.origin)),
              "expected binding lookup after session delete to succeed",
            ),
          );
          assert.strictEqual(yield* bindingCountForSession(otherSession.ref), 0);
        }),
      );
    }),
  );

  it.effect("concurrent creates for the same session produce one success and one conflict", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          const results = yield* Effect.all(
            [
              Effect.promise(() => store.sessions.create(session)),
              Effect.promise(() => store.sessions.create(session)),
            ],
            { concurrency: "unbounded" },
          );

          assert.strictEqual(results.filter((result) => result.isOk()).length, 1);
          const conflicts = results.filter((result) => result.isErr());
          assert.strictEqual(conflicts.length, 1);
          const conflict = conflicts[0];
          if (conflict === undefined) {
            assert.fail("expected one conflict result");
          }
          expectStoreConflictError(conflict);
        }),
      );
    }),
  );

  it.effect("bind and update races with session delete leave coherent final state", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session create to succeed",
          );

          const [bindResult, deleteResult] = yield* Effect.all(
            [
              Effect.promise(() => store.threadBindings.bind(bindFor())),
              Effect.promise(() => store.sessions.delete(session.ref)),
            ],
            { concurrency: "unbounded" },
          );
          if (bindResult.isErr()) {
            assert.isTrue(StoreNotFoundError.is(bindResult.error));
          }
          expectOk(deleteResult, "expected delete in bind race to succeed");
          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.sessions.get(session.ref)),
              "expected session lookup after bind/delete race to succeed",
            ),
          );
          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.threadBindings.get(session.origin)),
              "expected binding lookup after bind/delete race to succeed",
            ),
          );

          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session recreate to succeed",
          );
          const [updateResult, deleteAgainResult] = yield* Effect.all(
            [
              Effect.promise(() =>
                store.sessions.update(session.ref, { title: "Raced update", updatedAt: later }),
              ),
              Effect.promise(() => store.sessions.delete(session.ref)),
            ],
            { concurrency: "unbounded" },
          );
          if (updateResult.isErr()) {
            assert.isTrue(StoreNotFoundError.is(updateResult.error));
          }
          expectOk(deleteAgainResult, "expected delete in update race to succeed");
          assert.isNull(
            expectOk(
              yield* Effect.promise(() => store.sessions.get(session.ref)),
              "expected session lookup after update/delete race to succeed",
            ),
          );
        }),
      );
    }),
  );

  it.effect("many concurrent bindings for one thread leave one coherent final row", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;
      const thread = { chatId: "telegram", threadId: "shared-thread" };
      const sessions = Array.from({ length: 16 }, (_, index) => ({
        ...session,
        ref: { harnessId: "opencode", sessionId: `session-${index}` },
        origin: { chatId: "telegram", threadId: `origin-${index}` },
        title: `Session ${index}`,
      })) satisfies ReadonlyArray<SessionRecord>;
      const bindings = sessions.map((record, index) =>
        bindFor({
          thread,
          sessionRef: record.ref,
          createdAt: `2026-05-08T10:${String(index).padStart(2, "0")}:00.000Z`,
        }),
      );

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          yield* Effect.all(
            sessions.map((record) =>
              Effect.promise(() => store.sessions.create(record)).pipe(
                Effect.map((result) => expectOk(result, "expected session create to succeed")),
              ),
            ),
            { concurrency: "unbounded" },
          );
          yield* Effect.all(
            bindings.map((binding) =>
              Effect.promise(() => store.threadBindings.bind(binding)).pipe(
                Effect.map((result) => expectOk(result, "expected binding to succeed")),
              ),
            ),
            { concurrency: "unbounded" },
          );

          const fetched = expectOk(
            yield* Effect.promise(() => store.threadBindings.get(thread)),
            "expected final binding lookup to succeed",
          );
          if (fetched === null) {
            assert.fail("expected final binding row to exist");
          }
          assert.isTrue(bindings.some((binding) => sameBinding(binding, fetched)));
          assert.strictEqual(yield* bindingCountForThread(thread), 1);
        }),
      );
    }),
  );

  it.effect("many concurrent workspace updates leave one coherent non-malformed row", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;
      const thread = { chatId: "telegram", threadId: "workspace-thread" };
      const workspaces = Array.from({ length: 24 }, (_, index) => ({
        thread,
        cwd: `/repo/workspace-${index}`,
        createdAt: `2026-05-08T11:${String(index).padStart(2, "0")}:00.000Z`,
        updatedAt: `2026-05-08T12:${String(index).padStart(2, "0")}:00.000Z`,
      })) satisfies ReadonlyArray<ThreadWorkspace>;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          yield* Effect.all(
            workspaces.map((candidate) =>
              Effect.promise(() => store.workspaces.set(candidate)).pipe(
                Effect.map((result) => expectOk(result, "expected workspace set to succeed")),
              ),
            ),
            { concurrency: "unbounded" },
          );

          const fetched = expectOk(
            yield* Effect.promise(() => store.workspaces.get(thread)),
            "expected final workspace lookup to succeed",
          );
          if (fetched === null) {
            assert.fail("expected final workspace row to exist");
          }
          assert.isTrue(workspaces.some((candidate) => sameWorkspace(candidate, fetched)));
          assert.isAbove(fetched.cwd.length, 0);
          assert.isAbove(fetched.createdAt.length, 0);
          assert.isAbove(fetched.updatedAt.length, 0);
          assert.strictEqual(yield* workspaceCountForThread(thread), 1);
        }),
      );
    }),
  );

  it.effect("invalid persisted row values decode as StoreOperationError", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO ${sql(ORCHESTRATOR_SESSION_TABLE)} (
              harness_id,
              session_id,
              origin_chat_id,
              origin_thread_id,
              requester_user_id,
              requester_display_name,
              cwd,
              title,
              created_at,
              updated_at
            )
            VALUES (
              ${thirdSession.ref.harnessId},
              ${thirdSession.ref.sessionId},
              ${thirdSession.origin.chatId},
              ${thirdSession.origin.threadId},
              ${thirdSession.requester.userId},
              NULL,
              x'CAFE',
              NULL,
              ${thirdSession.createdAt},
              ${thirdSession.updatedAt}
            )
          `.withoutTransform;

          const error = expectStoreOperationError(
            yield* Effect.promise(() => store.sessions.get(thirdSession.ref)),
            { operation: "read", resource: "session" },
          );
          assert.include(error.message, "Failed to read session");
        }),
      );
    }),
  );

  it.effect("manually corrupted duplicate lookup rows fail diagnostically", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.unsafe("PRAGMA foreign_keys = OFF").withoutTransform;
          yield* sql`DROP TABLE ${sql(ORCHESTRATOR_SESSION_TABLE)}`.withoutTransform;
          yield* sql.unsafe(`
            CREATE TABLE ${ORCHESTRATOR_SESSION_TABLE} (
              harness_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              origin_chat_id TEXT NOT NULL,
              origin_thread_id TEXT NOT NULL,
              requester_user_id TEXT NOT NULL,
              requester_display_name TEXT NULL,
              cwd TEXT NOT NULL,
              title TEXT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          `).withoutTransform;
          yield* insertRawSessionRow(thirdSession);
          yield* insertRawSessionRow({ ...thirdSession, title: "duplicate row" });

          const error = expectStoreOperationError(
            yield* Effect.promise(() => store.sessions.get(thirdSession.ref)),
            { operation: "read", resource: "session" },
          );
          assert.include(error.message, "Unexpected session row count");
        }),
      );
    }),
  );

  it.effect("empty critical strings are rejected by database constraints", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* withInitializedStore(paths, (store) =>
        Effect.gen(function* () {
          expectStoreOperationError(
            yield* Effect.promise(() =>
              store.sessions.create({
                ...session,
                ref: { ...session.ref, sessionId: "" },
              }),
            ),
            { operation: "create", resource: "session" },
          );

          expectOk(
            yield* Effect.promise(() => store.sessions.create(session)),
            "expected session create to succeed",
          );
          expectStoreOperationError(
            yield* Effect.promise(() =>
              store.threadBindings.bind(bindFor({ thread: { chatId: "", threadId: "thread" } })),
            ),
            { operation: "create", resource: "thread_binding" },
          );
          expectStoreOperationError(
            yield* Effect.promise(() => store.workspaces.set({ ...workspace, cwd: "" })),
            { operation: "update", resource: "thread_workspace" },
          );
        }),
      );
    }),
  );

  it.effect(
    "migration schema exposes expected composite keys, cascade FK, indexes, and NOT NULL columns",
    () =>
      Effect.gen(function* () {
        const paths = yield* makePreparedPaths;

        yield* withInitializedStore(paths, () =>
          Effect.gen(function* () {
            const sessionColumns = yield* readTableInfo(ORCHESTRATOR_SESSION_TABLE);
            assert.deepEqual(
              sessionColumns.map((row) => ({ name: row.name, notnull: row.notnull, pk: row.pk })),
              [
                { name: "harness_id", notnull: 1, pk: 1 },
                { name: "session_id", notnull: 1, pk: 2 },
                { name: "origin_chat_id", notnull: 1, pk: 0 },
                { name: "origin_thread_id", notnull: 1, pk: 0 },
                { name: "requester_user_id", notnull: 1, pk: 0 },
                { name: "requester_display_name", notnull: 0, pk: 0 },
                { name: "cwd", notnull: 1, pk: 0 },
                { name: "title", notnull: 0, pk: 0 },
                { name: "created_at", notnull: 1, pk: 0 },
                { name: "updated_at", notnull: 1, pk: 0 },
              ],
            );

            const bindingColumns = yield* readTableInfo(THREAD_BINDING_TABLE);
            assert.deepEqual(
              bindingColumns.map((row) => ({ name: row.name, notnull: row.notnull, pk: row.pk })),
              [
                { name: "chat_id", notnull: 1, pk: 1 },
                { name: "thread_id", notnull: 1, pk: 2 },
                { name: "harness_id", notnull: 1, pk: 0 },
                { name: "session_id", notnull: 1, pk: 0 },
                { name: "created_at", notnull: 1, pk: 0 },
              ],
            );

            const workspaceColumns = yield* readTableInfo(THREAD_WORKSPACE_TABLE);
            assert.deepEqual(
              workspaceColumns.map((row) => ({ name: row.name, notnull: row.notnull, pk: row.pk })),
              [
                { name: "chat_id", notnull: 1, pk: 1 },
                { name: "thread_id", notnull: 1, pk: 2 },
                { name: "cwd", notnull: 1, pk: 0 },
                { name: "created_at", notnull: 1, pk: 0 },
                { name: "updated_at", notnull: 1, pk: 0 },
              ],
            );

            const foreignKeys = [...(yield* readThreadBindingForeignKeys)].sort(
              (left, right) => left.seq - right.seq,
            );
            assert.deepEqual(
              foreignKeys.map((row) => ({
                id: row.id,
                seq: row.seq,
                table: row.table,
                from: row.from,
                to: row.to,
                onDelete: row.on_delete,
              })),
              [
                {
                  id: 0,
                  seq: 0,
                  table: ORCHESTRATOR_SESSION_TABLE,
                  from: "harness_id",
                  to: "harness_id",
                  onDelete: "CASCADE",
                },
                {
                  id: 0,
                  seq: 1,
                  table: ORCHESTRATOR_SESSION_TABLE,
                  from: "session_id",
                  to: "session_id",
                  onDelete: "CASCADE",
                },
              ],
            );

            const indexes = yield* readThreadBindingIndexes;
            const sessionIndex = indexes.find((row) => row.name === THREAD_BINDING_SESSION_INDEX);
            assert.isDefined(sessionIndex);
            assert.strictEqual(sessionIndex?.unique, 0);
            assert.deepEqual(
              (yield* readThreadBindingSessionIndexInfo).map((row) => row.name),
              ["harness_id", "session_id"],
            );
          }),
        );
      }),
  );

  it.effect("database PRAGMAs are guaranteed on every opened connection", () =>
    Effect.gen(function* () {
      const paths = yield* makePreparedPaths;

      yield* runDbStartup(paths);

      assertPragmas(yield* readPragmasOnNewConnection(paths));
      assertPragmas(yield* readPragmasOnNewConnection(paths));
    }),
  );
});
