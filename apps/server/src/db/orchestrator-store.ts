import {
  Result,
  StoreConflictError,
  StoreNotFoundError,
  StoreOperationError,
  type ChatThreadRef,
  type SessionRecord,
  type SessionRecordPatch,
  type Store,
  type StoreOperation,
  type ThreadBinding,
  type ThreadWorkspace,
} from "@xmux/orchestrator";
import { Context, Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  decodeSessionRows,
  decodeThreadBindingRows,
  decodeThreadWorkspaceRows,
  sessionRowToRecord,
  type SessionRow,
  threadBindingRowToBinding,
  type ThreadBindingRow,
  threadWorkspaceRowToWorkspace,
  type ThreadWorkspaceRow,
} from "./orchestrator-store-rows";
import { ORCHESTRATOR_SESSION_TABLE, THREAD_BINDING_TABLE, THREAD_WORKSPACE_TABLE } from "./schema";

const SESSION_RESOURCE = "session";
const THREAD_BINDING_RESOURCE = "thread_binding";
const THREAD_WORKSPACE_RESOURCE = "thread_workspace";

type StoreResource =
  | typeof SESSION_RESOURCE
  | typeof THREAD_BINDING_RESOURCE
  | typeof THREAD_WORKSPACE_RESOURCE;

class StoreRowCountError extends Schema.TaggedErrorClass<StoreRowCountError>()(
  "StoreRowCountError",
  {
    resource: Schema.String,
    expected: Schema.String,
    actual: Schema.Number,
    message: Schema.String,
  },
) {}

const unexpectedRowCount = (input: {
  readonly resource: StoreResource;
  readonly expected: string;
  readonly actual: number;
}): StoreRowCountError =>
  StoreRowCountError.make({
    ...input,
    message: `Unexpected ${input.resource} row count: expected ${input.expected}, got ${input.actual}`,
  });

const singleOrNull = <A>(input: {
  readonly rows: ReadonlyArray<A>;
  readonly resource: StoreResource;
}): Effect.Effect<A | null, StoreRowCountError> => {
  if (input.rows.length > 1) {
    return Effect.fail(
      unexpectedRowCount({
        resource: input.resource,
        expected: "0 or 1",
        actual: input.rows.length,
      }),
    );
  }

  return Effect.succeed(input.rows[0] ?? null);
};

const exactlyOne = <A>(input: {
  readonly rows: ReadonlyArray<A>;
  readonly resource: StoreResource;
}): Effect.Effect<A, StoreRowCountError> => {
  const row = input.rows[0];
  if (input.rows.length !== 1 || row === undefined) {
    return Effect.fail(
      unexpectedRowCount({
        resource: input.resource,
        expected: "1",
        actual: input.rows.length,
      }),
    );
  }

  return Effect.succeed(row);
};

const sessionKey = (ref: SessionRecord["ref"]): string => `${ref.harnessId}:${ref.sessionId}`;

const nullableString = (value: string | undefined): string | null => value ?? null;

const storeOperationError = (input: {
  readonly operation: StoreOperation;
  readonly resource: StoreResource;
  readonly cause: unknown;
}): StoreOperationError =>
  new StoreOperationError({
    operation: input.operation,
    resource: input.resource,
    cause: input.cause,
  });

const runStoreEffect = async <A>(input: {
  readonly operation: StoreOperation;
  readonly resource: StoreResource;
  readonly effect: Effect.Effect<A, unknown, never>;
}): Promise<Result<A, StoreOperationError>> => {
  const nested = await Result.tryPromise({
    try: () =>
      Effect.runPromise(
        input.effect.pipe(
          Effect.matchCause({
            onFailure: (cause) =>
              Result.err<A, StoreOperationError>(
                storeOperationError({
                  operation: input.operation,
                  resource: input.resource,
                  cause,
                }),
              ),
            onSuccess: (value) => Result.ok<A, StoreOperationError>(value),
          }),
        ),
      ),
    catch: (cause) =>
      storeOperationError({
        operation: input.operation,
        resource: input.resource,
        cause,
      }),
  });

  return Result.flatten(nested);
};

const decodeOptionalSessionRecord = (
  rows: ReadonlyArray<SessionRow>,
): Effect.Effect<SessionRecord | null, unknown> =>
  Effect.gen(function* () {
    const decodedRows = yield* decodeSessionRows(rows);
    const row = yield* singleOrNull({ rows: decodedRows, resource: SESSION_RESOURCE });
    return row === null ? null : sessionRowToRecord(row);
  });

const decodeOptionalThreadBinding = (
  rows: ReadonlyArray<ThreadBindingRow>,
): Effect.Effect<ThreadBinding | null, unknown> =>
  Effect.gen(function* () {
    const decodedRows = yield* decodeThreadBindingRows(rows);
    const row = yield* singleOrNull({ rows: decodedRows, resource: THREAD_BINDING_RESOURCE });
    return row === null ? null : threadBindingRowToBinding(row);
  });

const decodeOptionalThreadWorkspace = (
  rows: ReadonlyArray<ThreadWorkspaceRow>,
): Effect.Effect<ThreadWorkspace | null, unknown> =>
  Effect.gen(function* () {
    const decodedRows = yield* decodeThreadWorkspaceRows(rows);
    const row = yield* singleOrNull({ rows: decodedRows, resource: THREAD_WORKSPACE_RESOURCE });
    return row === null ? null : threadWorkspaceRowToWorkspace(row);
  });

const decodeRequiredThreadWorkspace = (
  rows: ReadonlyArray<ThreadWorkspaceRow>,
): Effect.Effect<ThreadWorkspace, unknown> =>
  Effect.gen(function* () {
    const decodedRows = yield* decodeThreadWorkspaceRows(rows);
    const row = yield* exactlyOne({ rows: decodedRows, resource: THREAD_WORKSPACE_RESOURCE });
    return threadWorkspaceRowToWorkspace(row);
  });

export const makeSqliteOrchestratorStore: Effect.Effect<Store, never, SqlClient.SqlClient> =
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const insertSession = (
      record: SessionRecord,
    ): Effect.Effect<SessionRecord | null, unknown, never> =>
      Effect.gen(function* () {
        const rows = yield* sql<SessionRow>`
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
            ${nullableString(record.requester.displayName)},
            ${record.cwd},
            ${nullableString(record.title)},
            ${record.createdAt},
            ${record.updatedAt}
          )
          ON CONFLICT(harness_id, session_id) DO NOTHING
          RETURNING
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
        `.withoutTransform;

        return yield* decodeOptionalSessionRecord(rows);
      });

    const getSession = (ref: SessionRecord["ref"]): Effect.Effect<SessionRecord | null, unknown> =>
      Effect.gen(function* () {
        const rows = yield* sql<SessionRow>`
          SELECT
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
          FROM ${sql(ORCHESTRATOR_SESSION_TABLE)}
          WHERE harness_id = ${ref.harnessId}
            AND session_id = ${ref.sessionId}
        `.withoutTransform;

        return yield* decodeOptionalSessionRecord(rows);
      });

    const updateSession = (input: {
      readonly ref: SessionRecord["ref"];
      readonly patch: SessionRecordPatch;
    }): Effect.Effect<SessionRecord | null, unknown> =>
      Effect.gen(function* () {
        const updateTitle = input.patch.title === undefined ? 0 : 1;
        const title = nullableString(input.patch.title);
        const rows = yield* sql<SessionRow>`
          UPDATE ${sql(ORCHESTRATOR_SESSION_TABLE)}
          SET
            title = CASE WHEN ${updateTitle} = 1 THEN ${title} ELSE title END,
            updated_at = ${input.patch.updatedAt}
          WHERE harness_id = ${input.ref.harnessId}
            AND session_id = ${input.ref.sessionId}
          RETURNING
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
        `.withoutTransform;

        return yield* decodeOptionalSessionRecord(rows);
      });

    const deleteSession = (ref: SessionRecord["ref"]): Effect.Effect<void, unknown> =>
      sql`
        DELETE FROM ${sql(ORCHESTRATOR_SESSION_TABLE)}
        WHERE harness_id = ${ref.harnessId}
          AND session_id = ${ref.sessionId}
      `.withoutTransform.pipe(Effect.asVoid);

    const upsertThreadBinding = (binding: ThreadBinding): Effect.Effect<void, unknown> =>
      sql`
        INSERT INTO ${sql(THREAD_BINDING_TABLE)} (
          chat_id,
          thread_id,
          harness_id,
          session_id,
          created_at
        )
        VALUES (
          ${binding.thread.chatId},
          ${binding.thread.threadId},
          ${binding.sessionRef.harnessId},
          ${binding.sessionRef.sessionId},
          ${binding.createdAt}
        )
        ON CONFLICT(chat_id, thread_id) DO UPDATE SET
          harness_id = excluded.harness_id,
          session_id = excluded.session_id,
          created_at = excluded.created_at
      `.withoutTransform.pipe(Effect.asVoid);

    const getThreadBinding = (
      thread: ChatThreadRef,
    ): Effect.Effect<ThreadBinding | null, unknown> =>
      Effect.gen(function* () {
        const rows = yield* sql<ThreadBindingRow>`
          SELECT
            chat_id,
            thread_id,
            harness_id,
            session_id,
            created_at
          FROM ${sql(THREAD_BINDING_TABLE)}
          WHERE chat_id = ${thread.chatId}
            AND thread_id = ${thread.threadId}
        `.withoutTransform;

        return yield* decodeOptionalThreadBinding(rows);
      });

    const deleteThreadBinding = (thread: ChatThreadRef): Effect.Effect<void, unknown> =>
      sql`
        DELETE FROM ${sql(THREAD_BINDING_TABLE)}
        WHERE chat_id = ${thread.chatId}
          AND thread_id = ${thread.threadId}
      `.withoutTransform.pipe(Effect.asVoid);

    const deleteThreadBindingsBySession = (
      ref: SessionRecord["ref"],
    ): Effect.Effect<void, unknown> =>
      sql`
        DELETE FROM ${sql(THREAD_BINDING_TABLE)}
        WHERE harness_id = ${ref.harnessId}
          AND session_id = ${ref.sessionId}
      `.withoutTransform.pipe(Effect.asVoid);

    const upsertWorkspace = (workspace: ThreadWorkspace): Effect.Effect<ThreadWorkspace, unknown> =>
      Effect.gen(function* () {
        const rows = yield* sql<ThreadWorkspaceRow>`
          INSERT INTO ${sql(THREAD_WORKSPACE_TABLE)} (
            chat_id,
            thread_id,
            cwd,
            created_at,
            updated_at
          )
          VALUES (
            ${workspace.thread.chatId},
            ${workspace.thread.threadId},
            ${workspace.cwd},
            ${workspace.createdAt},
            ${workspace.updatedAt}
          )
          ON CONFLICT(chat_id, thread_id) DO UPDATE SET
            cwd = excluded.cwd,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
          RETURNING
            chat_id,
            thread_id,
            cwd,
            created_at,
            updated_at
        `.withoutTransform;

        return yield* decodeRequiredThreadWorkspace(rows);
      });

    const getWorkspace = (thread: ChatThreadRef): Effect.Effect<ThreadWorkspace | null, unknown> =>
      Effect.gen(function* () {
        const rows = yield* sql<ThreadWorkspaceRow>`
          SELECT
            chat_id,
            thread_id,
            cwd,
            created_at,
            updated_at
          FROM ${sql(THREAD_WORKSPACE_TABLE)}
          WHERE chat_id = ${thread.chatId}
            AND thread_id = ${thread.threadId}
        `.withoutTransform;

        return yield* decodeOptionalThreadWorkspace(rows);
      });

    const deleteWorkspace = (thread: ChatThreadRef): Effect.Effect<void, unknown> =>
      sql`
        DELETE FROM ${sql(THREAD_WORKSPACE_TABLE)}
        WHERE chat_id = ${thread.chatId}
          AND thread_id = ${thread.threadId}
      `.withoutTransform.pipe(Effect.asVoid);

    return {
      sessions: {
        async create(record) {
          const result = await runStoreEffect({
            operation: "create",
            resource: SESSION_RESOURCE,
            effect: insertSession(record),
          });

          return Result.andThen(result, (created) =>
            created === null
              ? Result.err<SessionRecord, StoreConflictError>(
                  new StoreConflictError({
                    resource: SESSION_RESOURCE,
                    id: sessionKey(record.ref),
                  }),
                )
              : Result.ok<SessionRecord, StoreConflictError>(created),
          );
        },

        async get(ref) {
          return runStoreEffect({
            operation: "read",
            resource: SESSION_RESOURCE,
            effect: getSession(ref),
          });
        },

        async update(ref, patch) {
          const result = await runStoreEffect({
            operation: "update",
            resource: SESSION_RESOURCE,
            effect: updateSession({ ref, patch }),
          });

          return Result.andThen(result, (updated) =>
            updated === null
              ? Result.err<SessionRecord, StoreNotFoundError>(
                  new StoreNotFoundError({ resource: SESSION_RESOURCE, id: sessionKey(ref) }),
                )
              : Result.ok<SessionRecord, StoreNotFoundError>(updated),
          );
        },

        async delete(ref) {
          return runStoreEffect({
            operation: "delete",
            resource: SESSION_RESOURCE,
            effect: deleteSession(ref),
          });
        },
      },

      threadBindings: {
        async bind(binding) {
          return runStoreEffect({
            operation: "create",
            resource: THREAD_BINDING_RESOURCE,
            effect: upsertThreadBinding(binding),
          });
        },

        async get(thread) {
          return runStoreEffect({
            operation: "read",
            resource: THREAD_BINDING_RESOURCE,
            effect: getThreadBinding(thread),
          });
        },

        async delete(thread) {
          return runStoreEffect({
            operation: "delete",
            resource: THREAD_BINDING_RESOURCE,
            effect: deleteThreadBinding(thread),
          });
        },

        async deleteBySession(ref) {
          return runStoreEffect({
            operation: "delete",
            resource: THREAD_BINDING_RESOURCE,
            effect: deleteThreadBindingsBySession(ref),
          });
        },
      },

      workspaces: {
        async get(thread) {
          return runStoreEffect({
            operation: "read",
            resource: THREAD_WORKSPACE_RESOURCE,
            effect: getWorkspace(thread),
          });
        },

        async set(workspace) {
          return runStoreEffect({
            operation: "update",
            resource: THREAD_WORKSPACE_RESOURCE,
            effect: upsertWorkspace(workspace),
          });
        },

        async delete(thread) {
          return runStoreEffect({
            operation: "delete",
            resource: THREAD_WORKSPACE_RESOURCE,
            effect: deleteWorkspace(thread),
          });
        },
      },
    } satisfies Store;
  });

export class OrchestratorStore extends Context.Service<OrchestratorStore, Store>()(
  "@xmux/server/OrchestratorStore",
) {
  static readonly layer = Layer.effect(OrchestratorStore, makeSqliteOrchestratorStore);
}
