import type { Client, Transaction } from "@libsql/client";
import { Result, type Result as ResultType } from "better-result";
import { SqliteMigrationError, SqliteSchemaCompatibilityError } from "./errors";
import { migrations } from "./migration-definitions";
import {
  ORCHESTRATOR_SESSION_TABLE,
  STORE_MIGRATIONS_TABLE,
  THREAD_BINDING_SESSION_INDEX,
  THREAD_BINDING_TABLE,
  THREAD_WORKSPACE_TABLE,
} from "./schema";

const migrationLocks = new Map<string, Promise<void>>();

type ExpectedColumn = {
  readonly name: string;
  readonly notNull: 0 | 1;
  readonly primaryKeyPosition: number;
  readonly checked: boolean;
};

const sessionColumns: readonly ExpectedColumn[] = [
  { name: "harness_id", notNull: 1, primaryKeyPosition: 1, checked: true },
  { name: "session_id", notNull: 1, primaryKeyPosition: 2, checked: true },
  { name: "origin_chat_id", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "origin_thread_id", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "requester_user_id", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "requester_display_name", notNull: 0, primaryKeyPosition: 0, checked: false },
  { name: "cwd", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "title", notNull: 0, primaryKeyPosition: 0, checked: false },
  { name: "created_at", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "updated_at", notNull: 1, primaryKeyPosition: 0, checked: true },
];

const bindingColumns: readonly ExpectedColumn[] = [
  { name: "chat_id", notNull: 1, primaryKeyPosition: 1, checked: true },
  { name: "thread_id", notNull: 1, primaryKeyPosition: 2, checked: true },
  { name: "harness_id", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "session_id", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "created_at", notNull: 1, primaryKeyPosition: 0, checked: true },
];

const workspaceColumns: readonly ExpectedColumn[] = [
  { name: "chat_id", notNull: 1, primaryKeyPosition: 1, checked: true },
  { name: "thread_id", notNull: 1, primaryKeyPosition: 2, checked: true },
  { name: "cwd", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "created_at", notNull: 1, primaryKeyPosition: 0, checked: true },
  { name: "updated_at", notNull: 1, primaryKeyPosition: 0, checked: true },
];

function compatibilityFailure(resource: string, reason: string): never {
  throw new SqliteSchemaCompatibilityError({ resource, reason });
}

function rowNumber(row: unknown, column: string, resource: string): number {
  const value = typeof row === "object" && row !== null ? Reflect.get(row, column) : undefined;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : compatibilityFailure(resource, `malformed ${column} metadata`);
}

function rowString(row: unknown, column: string, resource: string): string {
  const value = typeof row === "object" && row !== null ? Reflect.get(row, column) : undefined;
  return typeof value === "string"
    ? value
    : compatibilityFailure(resource, `malformed ${column} metadata`);
}

async function verifyTable(
  transaction: Transaction,
  table: string,
  expectedColumns: readonly ExpectedColumn[],
): Promise<void> {
  const master = await transaction.execute({
    sql: "SELECT type, sql FROM sqlite_master WHERE name = ?",
    args: [table],
  });
  if (master.rows.length !== 1 || master.rows[0] === undefined) {
    compatibilityFailure(table, "required table is missing");
  }
  const masterRow = master.rows[0];
  if (rowString(masterRow, "type", table) !== "table") {
    compatibilityFailure(table, "name is owned by a non-table object");
  }
  const normalizedSql = rowString(masterRow, "sql", table).toLowerCase().replaceAll(/\s/g, "");

  const tableInfo = await transaction.execute(`PRAGMA table_info(${table})`);
  for (const expected of expectedColumns) {
    const row = tableInfo.rows.find(
      (candidate) => rowString(candidate, "name", table) === expected.name,
    );
    if (row === undefined) compatibilityFailure(table, `missing column ${expected.name}`);
    if (rowString(row, "type", table).toLowerCase() !== "text") {
      compatibilityFailure(table, `column ${expected.name} must use TEXT affinity`);
    }
    if (rowNumber(row, "notnull", table) !== expected.notNull) {
      compatibilityFailure(table, `column ${expected.name} has incompatible nullability`);
    }
    if (rowNumber(row, "pk", table) !== expected.primaryKeyPosition) {
      compatibilityFailure(table, `column ${expected.name} has incompatible primary key position`);
    }
    if (expected.checked && !normalizedSql.includes(`check(length(${expected.name})>0)`)) {
      compatibilityFailure(table, `column ${expected.name} is missing its non-empty check`);
    }
  }
}

async function verifyBindingForeignKey(transaction: Transaction): Promise<void> {
  const rows = await transaction.execute(`PRAGMA foreign_key_list(${THREAD_BINDING_TABLE})`);
  const matching = rows.rows.filter(
    (row) =>
      rowString(row, "table", THREAD_BINDING_TABLE) === ORCHESTRATOR_SESSION_TABLE &&
      rowString(row, "on_delete", THREAD_BINDING_TABLE).toLowerCase() === "cascade",
  );
  const harness = matching.find(
    (row) =>
      rowString(row, "from", THREAD_BINDING_TABLE) === "harness_id" &&
      rowString(row, "to", THREAD_BINDING_TABLE) === "harness_id" &&
      rowNumber(row, "seq", THREAD_BINDING_TABLE) === 0,
  );
  const session = matching.find(
    (row) =>
      rowString(row, "from", THREAD_BINDING_TABLE) === "session_id" &&
      rowString(row, "to", THREAD_BINDING_TABLE) === "session_id" &&
      rowNumber(row, "seq", THREAD_BINDING_TABLE) === 1,
  );
  if (
    harness === undefined ||
    session === undefined ||
    rowNumber(harness, "id", THREAD_BINDING_TABLE) !==
      rowNumber(session, "id", THREAD_BINDING_TABLE)
  ) {
    compatibilityFailure(
      THREAD_BINDING_TABLE,
      "missing composite session foreign key with cascade",
    );
  }
}

async function verifyBindingIndex(transaction: Transaction): Promise<void> {
  const indexes = await transaction.execute(`PRAGMA index_list(${THREAD_BINDING_TABLE})`);
  const index = indexes.rows.find(
    (row) => rowString(row, "name", THREAD_BINDING_TABLE) === THREAD_BINDING_SESSION_INDEX,
  );
  if (index === undefined) {
    compatibilityFailure(THREAD_BINDING_TABLE, `missing index ${THREAD_BINDING_SESSION_INDEX}`);
  }
  if (rowNumber(index, "unique", THREAD_BINDING_TABLE) !== 0) {
    compatibilityFailure(THREAD_BINDING_TABLE, "session lookup index must be non-unique");
  }
  const columns = await transaction.execute(`PRAGMA index_info(${THREAD_BINDING_SESSION_INDEX})`);
  const names = [...columns.rows]
    .sort(
      (left, right) =>
        rowNumber(left, "seqno", THREAD_BINDING_SESSION_INDEX) -
        rowNumber(right, "seqno", THREAD_BINDING_SESSION_INDEX),
    )
    .map((row) => rowString(row, "name", THREAD_BINDING_SESSION_INDEX));
  if (names.length !== 2 || names[0] !== "harness_id" || names[1] !== "session_id") {
    compatibilityFailure(THREAD_BINDING_SESSION_INDEX, "must index harness_id then session_id");
  }
}

async function verifyStoreSchema(transaction: Transaction): Promise<void> {
  await verifyTable(transaction, ORCHESTRATOR_SESSION_TABLE, sessionColumns);
  await verifyTable(transaction, THREAD_BINDING_TABLE, bindingColumns);
  await verifyTable(transaction, THREAD_WORKSPACE_TABLE, workspaceColumns);
  await verifyBindingForeignKey(transaction);
  await verifyBindingIndex(transaction);
}

async function runMigrations(
  client: Client,
  input: { readonly path: string; readonly databaseId: string },
): Promise<ResultType<void, SqliteMigrationError>> {
  let currentMigration = "ledger";
  return Result.map(
    await Result.tryPromise({
      try: async () => {
        await client.execute(`CREATE TABLE IF NOT EXISTS ${STORE_MIGRATIONS_TABLE} (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        )`);

        const transaction = await client.transaction("write");
        try {
          const appliedRows = await transaction.execute(
            `SELECT migration_id, name FROM ${STORE_MIGRATIONS_TABLE}`,
          );
          const applied = new Map<number, string>();
          for (const row of appliedRows.rows) {
            const id = rowNumber(row, "migration_id", STORE_MIGRATIONS_TABLE);
            const name = rowString(row, "name", STORE_MIGRATIONS_TABLE);
            applied.set(id, name);
          }

          for (const migration of migrations) {
            currentMigration = migration.name;
            const appliedName = applied.get(migration.id);
            if (appliedName !== undefined && appliedName !== migration.name) {
              compatibilityFailure(
                STORE_MIGRATIONS_TABLE,
                `migration ${migration.id} has unexpected name`,
              );
            }
            if (appliedName === undefined) {
              for (const sql of migration.statements) await transaction.execute(sql);
            }
            await verifyStoreSchema(transaction);
            if (appliedName === undefined) {
              await transaction.execute({
                sql: `INSERT INTO ${STORE_MIGRATIONS_TABLE} (migration_id, name, applied_at)
                  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
                args: [migration.id, migration.name],
              });
            }
          }
          await transaction.commit();
        } finally {
          transaction.close();
        }
      },
      catch: (cause) =>
        new SqliteMigrationError({ path: input.path, migration: currentMigration, cause }),
    }),
    () => undefined,
  );
}

export async function migrateClient(
  client: Client,
  input: { readonly path: string; readonly databaseId: string },
): Promise<ResultType<void, SqliteMigrationError>> {
  const previous = migrationLocks.get(input.databaseId) ?? Promise.resolve();
  const attempt = previous.then(() => runMigrations(client, input));
  const lock = attempt.then(
    () => undefined,
    () => undefined,
  );
  migrationLocks.set(input.databaseId, lock);
  try {
    return await attempt;
  } finally {
    if (migrationLocks.get(input.databaseId) === lock) migrationLocks.delete(input.databaseId);
  }
}
