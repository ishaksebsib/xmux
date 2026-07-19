import { createClient, type Client, type ResultSet } from "@libsql/client";
import {
  StoreCloseError,
  StoreConflictError,
  StoreInitializationError,
  StoreNotFoundError,
  StoreOperationError,
  type SessionRecord,
  type Store,
  type StoreOperation,
} from "@xmux/orchestrator";
import { Result, type Result as ResultType } from "better-result";
import { pathToFileURL } from "node:url";
import { SqliteConfigurationError, SqliteResultShapeError, SqliteStoreStateError } from "./errors";
import { migrateClient } from "./migration-engine";
import {
  sessionRowToRecord,
  threadBindingRowToBinding,
  threadWorkspaceRowToWorkspace,
} from "./rows";
import { ORCHESTRATOR_SESSION_TABLE, THREAD_BINDING_TABLE, THREAD_WORKSPACE_TABLE } from "./schema";

const BACKEND = "sqlite";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const SESSION_RESOURCE = "session";
const THREAD_BINDING_RESOURCE = "thread_binding";
const THREAD_WORKSPACE_RESOURCE = "thread_workspace";

type StoreResource =
  | typeof SESSION_RESOURCE
  | typeof THREAD_BINDING_RESOURCE
  | typeof THREAD_WORKSPACE_RESOURCE;

type LifecycleState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Initializing";
      readonly attempt: Promise<ResultType<Client, StoreInitializationError>>;
    }
  | { readonly _tag: "Ready"; readonly client: Client }
  | { readonly _tag: "Failed"; readonly error: StoreInitializationError }
  | { readonly _tag: "Closing"; readonly attempt: Promise<ResultType<void, StoreCloseError>> }
  | { readonly _tag: "CloseFailed"; readonly client: Client; readonly error: StoreCloseError }
  | { readonly _tag: "Closed" };

export interface CreateSqliteStoreOptions {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}

function operationError(input: {
  readonly operation: StoreOperation;
  readonly resource: StoreResource;
  readonly cause: unknown;
}): StoreOperationError {
  return new StoreOperationError(input);
}

function sessionKey(ref: SessionRecord["ref"]): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

function optionalSingleRow(
  rows: ResultSet["rows"],
): ResultType<unknown | null, SqliteResultShapeError> {
  if (rows.length > 1) {
    return Result.err(new SqliteResultShapeError({ expected: "0 or 1", actual: rows.length }));
  }
  return Result.ok(rows[0] ?? null);
}

function requiredSingleRow(rows: ResultSet["rows"]): ResultType<unknown, SqliteResultShapeError> {
  const row = rows[0];
  return rows.length === 1 && row !== undefined
    ? Result.ok(row)
    : Result.err(new SqliteResultShapeError({ expected: "1", actual: rows.length }));
}

/**
 * Synchronously creates a lazy SQLite store. No filesystem or database I/O is
 * performed until `initialize()` (normally owned by `createXmux`).
 */
export function createSqliteStore(options: CreateSqliteStoreOptions): Store {
  let state: LifecycleState = { _tag: "Idle" };

  const open = async (): Promise<ResultType<Client, StoreInitializationError>> => {
    if (options.path.length === 0) {
      return Result.err(
        new StoreInitializationError({
          backend: BACKEND,
          cause: new SqliteConfigurationError({ field: "path", reason: "must not be empty" }),
        }),
      );
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      return Result.err(
        new StoreInitializationError({
          backend: BACKEND,
          cause: new SqliteConfigurationError({
            field: "busyTimeoutMs",
            reason: "must be a non-negative safe integer",
          }),
        }),
      );
    }

    const databaseId = Result.try({
      try: () => pathToFileURL(options.path).href,
      catch: (cause) => new StoreInitializationError({ backend: BACKEND, cause }),
    });
    if (databaseId.isErr()) return Result.err(databaseId.error);

    let candidate: Client | undefined;
    const opened = await Result.tryPromise({
      try: async () => {
        const client = createClient({ url: databaseId.value });
        candidate = client;
        await client.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
        await client.execute("PRAGMA foreign_keys = ON");
        await client.execute("PRAGMA journal_mode = WAL");
        await client.execute("PRAGMA synchronous = NORMAL");
        const foreignKeys = await client.execute("PRAGMA foreign_keys");
        const journalMode = await client.execute("PRAGMA journal_mode");
        if (Reflect.get(foreignKeys.rows[0] ?? {}, "foreign_keys") !== 1) {
          throw new Error("SQLite foreign key enforcement could not be enabled");
        }
        if (Reflect.get(journalMode.rows[0] ?? {}, "journal_mode") !== "wal") {
          throw new Error("SQLite WAL journal mode could not be enabled");
        }
        return client;
      },
      catch: (cause) => new StoreInitializationError({ backend: BACKEND, cause }),
    });
    if (opened.isErr()) {
      if (candidate !== undefined) {
        const cleanupClient = candidate;
        const cleanup = Result.try({ try: () => cleanupClient.close(), catch: (cause) => cause });
        if (cleanup.isErr()) {
          return Result.err(
            new StoreInitializationError({
              backend: BACKEND,
              cause: new AggregateError(
                [opened.error, cleanup.error],
                "Startup and cleanup failed",
              ),
            }),
          );
        }
      }
      return opened;
    }

    const migrated = await migrateClient(opened.value, {
      path: options.path,
      databaseId: databaseId.value,
    });
    if (migrated.isErr()) {
      const closed = Result.try({
        try: () => opened.value.close(),
        catch: (cause) => cause,
      });
      return Result.err(
        new StoreInitializationError({
          backend: BACKEND,
          cause: closed.isOk()
            ? migrated.error
            : new AggregateError([migrated.error, closed.error], "Migration and cleanup failed"),
        }),
      );
    }

    const reconfigured = await Result.tryPromise({
      try: async () => {
        await opened.value.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
        await opened.value.execute("PRAGMA foreign_keys = ON");
        await opened.value.execute("PRAGMA synchronous = NORMAL");
        const foreignKeys = await opened.value.execute("PRAGMA foreign_keys");
        if (Reflect.get(foreignKeys.rows[0] ?? {}, "foreign_keys") !== 1) {
          throw new Error("SQLite foreign key enforcement could not be enabled after migration");
        }
      },
      catch: (cause) => new StoreInitializationError({ backend: BACKEND, cause }),
    });
    if (reconfigured.isErr()) {
      const cleanupClient = opened.value;
      const cleanup = Result.try({ try: () => cleanupClient.close(), catch: (cause) => cause });
      return cleanup.isOk()
        ? Result.err(reconfigured.error)
        : Result.err(
            new StoreInitializationError({
              backend: BACKEND,
              cause: new AggregateError(
                [reconfigured.error, cleanup.error],
                "Post-migration configuration and cleanup failed",
              ),
            }),
          );
    }
    return Result.ok(opened.value);
  };

  const runOperation = async <A>(input: {
    readonly operation: StoreOperation;
    readonly resource: StoreResource;
    readonly run: (client: Client) => Promise<A>;
  }): Promise<ResultType<A, StoreOperationError>> => {
    if (state._tag !== "Ready") {
      return Result.err(
        operationError({
          operation: input.operation,
          resource: input.resource,
          cause: state._tag === "CloseFailed" ? state.error : new SqliteStoreStateError(state._tag),
        }),
      );
    }
    const client = state.client;
    return Result.tryPromise({
      try: () => input.run(client),
      catch: (cause) =>
        operationError({ operation: input.operation, resource: input.resource, cause }),
    });
  };

  const store: Store = {
    async initialize() {
      if (state._tag === "Ready") return Result.ok();
      if (state._tag === "Failed") return Result.err(state.error);
      if (state._tag === "Closed" || state._tag === "Closing" || state._tag === "CloseFailed") {
        return Result.err(
          new StoreInitializationError({
            backend: BACKEND,
            cause:
              state._tag === "CloseFailed" ? state.error : new SqliteStoreStateError(state._tag),
          }),
        );
      }
      if (state._tag === "Idle") {
        state = { _tag: "Initializing", attempt: open() };
      }

      const current = state;
      if (current._tag !== "Initializing") {
        return Result.err(
          new StoreInitializationError({
            backend: BACKEND,
            cause: new SqliteStoreStateError(current._tag),
          }),
        );
      }
      const initialized = await current.attempt;
      if (state._tag === "Initializing" && state.attempt === current.attempt) {
        state = initialized.isOk()
          ? { _tag: "Ready", client: initialized.value }
          : { _tag: "Failed", error: initialized.error };
      }
      return Result.map(initialized, () => undefined);
    },

    async close() {
      if (state._tag === "Closed" || state._tag === "Idle" || state._tag === "Failed") {
        state = { _tag: "Closed" };
        return Result.ok();
      }
      if (state._tag === "Initializing") {
        const current = state;
        const initialized = await current.attempt;
        if (state._tag === "Initializing" && state.attempt === current.attempt) {
          state = initialized.isOk()
            ? { _tag: "Ready", client: initialized.value }
            : { _tag: "Failed", error: initialized.error };
        }
        return store.close();
      }
      if (state._tag === "Closing") return state.attempt;

      const client = state.client;
      const attempt = Promise.resolve(
        Result.try({
          try: () => client.close(),
          catch: (cause) => new StoreCloseError({ backend: BACKEND, cause }),
        }),
      );
      state = { _tag: "Closing", attempt };
      const closed = await attempt;
      state = closed.isOk()
        ? { _tag: "Closed" }
        : { _tag: "CloseFailed", client, error: closed.error };
      return closed;
    },

    sessions: {
      async create(record) {
        const result = await runOperation({
          operation: "create",
          resource: SESSION_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `INSERT INTO ${ORCHESTRATOR_SESSION_TABLE} (
                harness_id, session_id, origin_chat_id, origin_thread_id,
                requester_user_id, requester_display_name, cwd, title, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(harness_id, session_id) DO NOTHING
              RETURNING *`,
              args: [
                record.ref.harnessId,
                record.ref.sessionId,
                record.origin.chatId,
                record.origin.threadId,
                record.requester.userId,
                record.requester.displayName ?? null,
                record.cwd,
                record.title ?? null,
                record.createdAt,
                record.updatedAt,
              ],
            }),
        });
        return Result.andThen(result, (resultSet) => {
          const row = optionalSingleRow(resultSet.rows);
          return Result.andThen(
            Result.mapError(row, (cause) =>
              operationError({ operation: "create", resource: SESSION_RESOURCE, cause }),
            ),
            (value) =>
              value === null
                ? Result.err<SessionRecord, StoreConflictError | StoreOperationError>(
                    new StoreConflictError({
                      resource: SESSION_RESOURCE,
                      id: sessionKey(record.ref),
                    }),
                  )
                : Result.mapError(sessionRowToRecord(value), (cause) =>
                    operationError({ operation: "create", resource: SESSION_RESOURCE, cause }),
                  ),
          );
        });
      },

      async get(ref) {
        const result = await runOperation({
          operation: "read",
          resource: SESSION_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `SELECT * FROM ${ORCHESTRATOR_SESSION_TABLE}
                WHERE harness_id = ? AND session_id = ?`,
              args: [ref.harnessId, ref.sessionId],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(optionalSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "read", resource: SESSION_RESOURCE, cause }),
            ),
            (row) =>
              row === null
                ? Result.ok(null)
                : Result.mapError(sessionRowToRecord(row), (cause) =>
                    operationError({ operation: "read", resource: SESSION_RESOURCE, cause }),
                  ),
          ),
        );
      },

      async update(ref, patch) {
        const result = await runOperation({
          operation: "update",
          resource: SESSION_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `UPDATE ${ORCHESTRATOR_SESSION_TABLE}
                SET title = CASE WHEN ? = 1 THEN ? ELSE title END, updated_at = ?
                WHERE harness_id = ? AND session_id = ? RETURNING *`,
              args: [
                patch.title === undefined ? 0 : 1,
                patch.title ?? null,
                patch.updatedAt,
                ref.harnessId,
                ref.sessionId,
              ],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(optionalSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "update", resource: SESSION_RESOURCE, cause }),
            ),
            (row) =>
              row === null
                ? Result.err<SessionRecord, StoreNotFoundError | StoreOperationError>(
                    new StoreNotFoundError({ resource: SESSION_RESOURCE, id: sessionKey(ref) }),
                  )
                : Result.mapError(sessionRowToRecord(row), (cause) =>
                    operationError({ operation: "update", resource: SESSION_RESOURCE, cause }),
                  ),
          ),
        );
      },

      async delete(ref) {
        return runOperation({
          operation: "delete",
          resource: SESSION_RESOURCE,
          run: async (client) => {
            await client.batch(
              [
                {
                  sql: `DELETE FROM ${THREAD_BINDING_TABLE}
                    WHERE harness_id = ? AND session_id = ?`,
                  args: [ref.harnessId, ref.sessionId],
                },
                {
                  sql: `DELETE FROM ${ORCHESTRATOR_SESSION_TABLE}
                    WHERE harness_id = ? AND session_id = ?`,
                  args: [ref.harnessId, ref.sessionId],
                },
              ],
              "write",
            );
          },
        });
      },
    },

    threadBindings: {
      async bind(binding) {
        const result = await runOperation({
          operation: "create",
          resource: THREAD_BINDING_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `INSERT INTO ${THREAD_BINDING_TABLE}
                (chat_id, thread_id, harness_id, session_id, created_at)
                SELECT ?, ?, ?, ?, ?
                WHERE EXISTS (
                  SELECT 1 FROM ${ORCHESTRATOR_SESSION_TABLE}
                  WHERE harness_id = ? AND session_id = ?
                )
                ON CONFLICT(chat_id, thread_id) DO UPDATE SET
                  harness_id = excluded.harness_id,
                  session_id = excluded.session_id,
                  created_at = excluded.created_at
                RETURNING chat_id`,
              args: [
                binding.thread.chatId,
                binding.thread.threadId,
                binding.sessionRef.harnessId,
                binding.sessionRef.sessionId,
                binding.createdAt,
                binding.sessionRef.harnessId,
                binding.sessionRef.sessionId,
              ],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(optionalSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "create", resource: THREAD_BINDING_RESOURCE, cause }),
            ),
            (row) =>
              row === null
                ? Result.err(
                    new StoreNotFoundError({
                      resource: SESSION_RESOURCE,
                      id: sessionKey(binding.sessionRef),
                    }),
                  )
                : Result.ok(),
          ),
        );
      },

      async get(thread) {
        const result = await runOperation({
          operation: "read",
          resource: THREAD_BINDING_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `SELECT * FROM ${THREAD_BINDING_TABLE} WHERE chat_id = ? AND thread_id = ?`,
              args: [thread.chatId, thread.threadId],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(optionalSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "read", resource: THREAD_BINDING_RESOURCE, cause }),
            ),
            (row) =>
              row === null
                ? Result.ok(null)
                : Result.mapError(threadBindingRowToBinding(row), (cause) =>
                    operationError({ operation: "read", resource: THREAD_BINDING_RESOURCE, cause }),
                  ),
          ),
        );
      },

      async delete(thread) {
        return runOperation({
          operation: "delete",
          resource: THREAD_BINDING_RESOURCE,
          run: async (client) => {
            await client.execute({
              sql: `DELETE FROM ${THREAD_BINDING_TABLE} WHERE chat_id = ? AND thread_id = ?`,
              args: [thread.chatId, thread.threadId],
            });
          },
        });
      },

      async deleteBySession(ref) {
        return runOperation({
          operation: "delete",
          resource: THREAD_BINDING_RESOURCE,
          run: async (client) => {
            await client.execute({
              sql: `DELETE FROM ${THREAD_BINDING_TABLE} WHERE harness_id = ? AND session_id = ?`,
              args: [ref.harnessId, ref.sessionId],
            });
          },
        });
      },
    },

    workspaces: {
      async get(thread) {
        const result = await runOperation({
          operation: "read",
          resource: THREAD_WORKSPACE_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `SELECT * FROM ${THREAD_WORKSPACE_TABLE} WHERE chat_id = ? AND thread_id = ?`,
              args: [thread.chatId, thread.threadId],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(optionalSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "read", resource: THREAD_WORKSPACE_RESOURCE, cause }),
            ),
            (row) =>
              row === null
                ? Result.ok(null)
                : Result.mapError(threadWorkspaceRowToWorkspace(row), (cause) =>
                    operationError({
                      operation: "read",
                      resource: THREAD_WORKSPACE_RESOURCE,
                      cause,
                    }),
                  ),
          ),
        );
      },

      async set(workspace) {
        const result = await runOperation({
          operation: "update",
          resource: THREAD_WORKSPACE_RESOURCE,
          run: (client) =>
            client.execute({
              sql: `INSERT INTO ${THREAD_WORKSPACE_TABLE}
                (chat_id, thread_id, cwd, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(chat_id, thread_id) DO UPDATE SET
                  cwd = excluded.cwd,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at
                RETURNING *`,
              args: [
                workspace.thread.chatId,
                workspace.thread.threadId,
                workspace.cwd,
                workspace.createdAt,
                workspace.updatedAt,
              ],
            }),
        });
        return Result.andThen(result, (resultSet) =>
          Result.andThen(
            Result.mapError(requiredSingleRow(resultSet.rows), (cause) =>
              operationError({ operation: "update", resource: THREAD_WORKSPACE_RESOURCE, cause }),
            ),
            (row) =>
              Result.mapError(threadWorkspaceRowToWorkspace(row), (cause) =>
                operationError({ operation: "update", resource: THREAD_WORKSPACE_RESOURCE, cause }),
              ),
          ),
        );
      },

      async delete(thread) {
        return runOperation({
          operation: "delete",
          resource: THREAD_WORKSPACE_RESOURCE,
          run: async (client) => {
            await client.execute({
              sql: `DELETE FROM ${THREAD_WORKSPACE_TABLE} WHERE chat_id = ? AND thread_id = ?`,
              args: [thread.chatId, thread.threadId],
            });
          },
        });
      },
    },
  };

  return store;
}
