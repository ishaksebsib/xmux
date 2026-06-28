import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as LibsqlMigrator from "@effect/sql-libsql/LibsqlMigrator";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { testOrchestratorFactoryLayer } from "./support/orchestrator";
import { makeSecretResolverLayer } from "./support/secrets";
import { makeTestPaths } from "./support/paths";
import { ServerConfig } from "../src/config/service";
import type { ControlServerError } from "../src/errors";
import {
  databasePathFromString,
  isoTimestampFromString,
  processIdFromNumber,
  sessionIdFromString,
} from "../src/contracts/primitives";
import { applyDatabasePragmas } from "../src/db/pragmas";
import { initializeDatabase, makeDatabaseSqlLayer } from "../src/db/layer";
import { formatAppliedMigrationId, runDatabaseMigrationsWithLoader } from "../src/db/migrations";
import {
  DATABASE_NAMESPACE_KEY,
  DATABASE_NAMESPACE_VALUE,
  DB_METADATA_TABLE,
  MIGRATIONS_TABLE,
  ORCHESTRATOR_SESSION_TABLE,
  THREAD_BINDING_SESSION_INDEX,
  THREAD_BINDING_TABLE,
  THREAD_WORKSPACE_TABLE,
} from "../src/db/schema";
import { LogReader } from "../src/logging/log-reader";
import { nodeHostRuntimeLayer } from "../src/platform/node";
import { RuntimePaths, type ServerRuntimePaths } from "../src/server-control/paths";
import { ControlTransport, ServerProbe } from "../src/server-control/ports";
import { ServerIdentity } from "../src/server-runtime/identity";
import { ShutdownCoordinator } from "../src/server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../src/server-runtime/state";
import { serverMain } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const secretLayer = makeSecretResolverLayer(new Map());
const serverProbeUnreachableLayer = Layer.succeed(ServerProbe)({
  isAlive: () => Effect.succeed(false),
});

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-db-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

const makePreparedPaths = Effect.gen(function* () {
  const root = yield* makeTempRoot;
  const paths = makeTestPaths({ root });
  yield* Effect.promise(() => mkdir(paths.stateDir, { recursive: true }));
  return paths;
});

const runDbStartup = (paths: ServerRuntimePaths) =>
  Effect.scoped(initializeDatabase().pipe(Effect.provide(Layer.succeed(RuntimePaths)(paths))));

const withInvalidDirectoryDbPath = (paths: ServerRuntimePaths): ServerRuntimePaths => ({
  ...paths,
  dbPath: databasePathFromString(paths.stateDir),
});

type TableNameRow = { readonly name: string };
type MigrationLedgerRow = { readonly migration_id: number; readonly name: string };
type MetadataRow = { readonly key: string; readonly value: string };
type OrchestratorStoreTable =
  | typeof ORCHESTRATOR_SESSION_TABLE
  | typeof THREAD_BINDING_TABLE
  | typeof THREAD_WORKSPACE_TABLE;
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
  paths: ServerRuntimePaths,
  table: OrchestratorStoreTable,
): Effect.Effect<ReadonlyArray<TableInfoRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.unsafe<TableInfoRow>(`PRAGMA table_info(${table})`).withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readThreadBindingForeignKeys = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<ForeignKeyListRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.unsafe<ForeignKeyListRow>(
        `PRAGMA foreign_key_list(${THREAD_BINDING_TABLE})`,
      ).withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readThreadBindingIndexes = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<IndexListRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.unsafe<IndexListRow>(`PRAGMA index_list(${THREAD_BINDING_TABLE})`)
        .withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

const readThreadBindingSessionIndexInfo = (
  paths: ServerRuntimePaths,
): Effect.Effect<ReadonlyArray<IndexInfoRow>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.unsafe<IndexInfoRow>(`PRAGMA index_info(${THREAD_BINDING_SESSION_INDEX})`)
        .withoutTransform;
    }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
  );

interface TestControlTransport {
  readonly bind: () => Effect.Effect<void, ControlServerError>;
}

const makeServerLayer = (paths: ServerRuntimePaths, transport: TestControlTransport) => {
  const base = Layer.mergeAll(
    nodeHostRuntimeLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    secretLayer,
    testOrchestratorFactoryLayer,
    serverProbeUnreachableLayer,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: processIdFromNumber(process.pid),
      startedAt: fixedStartedAt,
      startedAtIso: isoTimestampFromString(fixedStartedAt.toISOString()),
      sessionId: sessionIdFromString("db-test"),
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfig.layer, base);
  const withLogReader = Layer.provideMerge(LogReader.layer, withConfig);

  return Layer.mergeAll(
    withLogReader,
    StatusRegistry.layer,
    ShutdownCoordinator.layer,
    Layer.succeed(ControlTransport)(transport),
  );
};

it.effect("initializes a file database with ledger, metadata, and orchestrator store tables", () =>
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
        ORCHESTRATOR_SESSION_TABLE,
        THREAD_BINDING_TABLE,
        THREAD_WORKSPACE_TABLE,
        DB_METADATA_TABLE,
        MIGRATIONS_TABLE,
      ].sort(),
    );

    const ledger = yield* readMigrationLedger(paths);
    assert.deepEqual(
      ledger.map((row) => formatAppliedMigrationId([row.migration_id, row.name])),
      ["0001_database_foundation", "0002_orchestrator_store"],
    );

    const metadataRows = yield* readMetadataRows(paths);
    assert.deepEqual(metadataRows, [
      { key: DATABASE_NAMESPACE_KEY, value: DATABASE_NAMESPACE_VALUE },
    ]);
  }),
);

it.effect("orchestrator store migration creates expected keys, constraints, and indexes", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    yield* runDbStartup(paths);

    const sessionColumns = yield* readTableInfo(paths, ORCHESTRATOR_SESSION_TABLE);
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

    const bindingColumns = yield* readTableInfo(paths, THREAD_BINDING_TABLE);
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

    const workspaceColumns = yield* readTableInfo(paths, THREAD_WORKSPACE_TABLE);
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

    const foreignKeys = [...(yield* readThreadBindingForeignKeys(paths))].sort(
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

    const indexes = yield* readThreadBindingIndexes(paths);
    const sessionIndex = indexes.find((row) => row.name === THREAD_BINDING_SESSION_INDEX);
    assert.isDefined(sessionIndex);
    assert.strictEqual(sessionIndex?.unique, 0);
    assert.deepEqual(
      (yield* readThreadBindingSessionIndexInfo(paths)).map((row) => row.name),
      ["harness_id", "session_id"],
    );
  }),
);

it.effect("database startup is idempotent", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    const first = yield* runDbStartup(paths);
    const second = yield* runDbStartup(paths);

    assert.strictEqual(first.appliedMigrations.length, 2);
    assert.strictEqual(second.appliedMigrations.length, 0);
    assert.strictEqual((yield* readMigrationLedger(paths)).length, 2);
    assert.strictEqual((yield* readMetadataRows(paths)).length, 1);
  }),
);

it.effect("applies SQLite PRAGMAs on the active DB connection", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* applyDatabasePragmas(paths.dbPath);
        const sql = yield* SqlClient.SqlClient;
        const foreignKeys = yield* sql<{ readonly foreign_keys: number }>`PRAGMA foreign_keys`
          .withoutTransform;
        const journalMode = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode`
          .withoutTransform;

        assert.strictEqual(foreignKeys[0]?.foreign_keys, 1);
        assert.strictEqual(journalMode[0]?.journal_mode.toLowerCase(), "wal");
      }).pipe(Effect.provide(makeDatabaseSqlLayer(paths))),
    );
  }),
);

it.effect("database startup failures surface as typed database startup errors", () =>
  Effect.gen(function* () {
    const paths = withInvalidDirectoryDbPath(yield* makePreparedPaths);

    const error = yield* runDbStartup(paths).pipe(Effect.flip);

    assert.strictEqual(error._tag, "DatabaseStartupError");
    assert.strictEqual(error.path, paths.dbPath);
  }),
);

it.effect("server startup migrates the database before publishing readiness", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    const transport: TestControlTransport = {
      bind: () =>
        Effect.gen(function* () {
          const tableNames = yield* readTableNames(paths).pipe(Effect.orDie);
          assert.isTrue(tableNames.includes(MIGRATIONS_TABLE));
          assert.isTrue(tableNames.includes(DB_METADATA_TABLE));
          assert.isTrue(tableNames.includes(ORCHESTRATOR_SESSION_TABLE));
          assert.isTrue(tableNames.includes(THREAD_BINDING_TABLE));
          assert.isTrue(tableNames.includes(THREAD_WORKSPACE_TABLE));
        }),
    };

    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
        const shutdown = yield* ShutdownCoordinator;
        yield* shutdown.completeShutdown();
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(makeServerLayer(paths, transport))),
    );
  }),
);

it.effect("database startup failure prevents transport bind, manifest publish, and readiness", () =>
  Effect.gen(function* () {
    const paths = withInvalidDirectoryDbPath(yield* makePreparedPaths);
    const bindCalled = yield* Ref.make(false);
    const transport: TestControlTransport = {
      bind: () => Ref.set(bindCalled, true),
    };

    const layer = makeServerLayer(paths, transport);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const error = yield* Effect.scoped(serverMain()).pipe(Effect.flip);
        const status = yield* StatusRegistry;

        assert.strictEqual(error._tag, "DatabaseStartupError");
        assert.isFalse(yield* Ref.get(bindCalled));
        assert.isFalse(yield* exists(paths.manifestPath));
        assert.strictEqual(yield* status.getState(), "starting");
      }).pipe(Effect.provide(layer)),
    );
  }),
);

it.effect("migration failures surface as typed database migration errors", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    const failingLoader = LibsqlMigrator.fromRecord({
      "0001_broken": Effect.fail("boom"),
    });

    const error = yield* Effect.scoped(
      runDatabaseMigrationsWithLoader({ path: paths.dbPath, loader: failingLoader }).pipe(
        Effect.provide(makeDatabaseSqlLayer(paths)),
      ),
    ).pipe(Effect.flip);

    assert.strictEqual(error._tag, "DatabaseMigrationError");
    assert.strictEqual(error.path, paths.dbPath);
  }),
);
