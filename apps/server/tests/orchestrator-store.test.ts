import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, it } from "@effect/vitest";
import {
  StoreConflictError,
  StoreNotFoundError,
  StoreOperationError,
  type SessionRecord,
  type Store,
  type ThreadBinding,
  type ThreadWorkspace,
} from "@xmux/orchestrator";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeTestPaths } from "./support/paths";
import { registerStoreContractTests } from "../../../packages/orchestrator/tests/support/store-contract";
import { makeDatabaseSqlLayer } from "../src/db/layer";
import { runDatabaseMigrations } from "../src/db/migrations";
import { makeSqliteOrchestratorStore } from "../src/db/orchestrator-store";
import { applyDatabasePragmas } from "../src/db/pragmas";
import { ORCHESTRATOR_SESSION_TABLE } from "../src/db/schema";
import type { ServerRuntimePaths } from "../src/server-control/paths";

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
  Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-orchestrator-store-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const makePreparedPaths = Effect.gen(function* () {
  const root = yield* makeTempRoot;
  const paths = makeTestPaths({ root });
  yield* Effect.promise(() => mkdir(paths.stateDir, { recursive: true }));
  return paths;
});

const withStore = <A, E, R>(
  paths: ServerRuntimePaths,
  use: (store: Store) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* applyDatabasePragmas(paths.dbPath);
      yield* runDatabaseMigrations(paths.dbPath);
      const store = yield* makeSqliteOrchestratorStore;
      return yield* use(store);
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

registerStoreContractTests({
  name: "makeSqliteOrchestratorStore",
  withStore: (use) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const paths = yield* makePreparedPaths;
          return yield* withStore(paths, (store) => Effect.promise(() => use(store)));
        }),
      ),
    ),
});

it.effect("sessions create/get/update/delete mirror in-memory behavior", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        const created = yield* Effect.promise(() => store.sessions.create(session));
        const fetched = yield* Effect.promise(() => store.sessions.get(session.ref));
        const updated = yield* Effect.promise(() =>
          store.sessions.update(session.ref, {
            title: "Fix bug quickly",
            updatedAt: later,
          }),
        );
        const preservedTitle = yield* Effect.promise(() =>
          store.sessions.update(session.ref, { updatedAt: "2026-05-08T10:10:00.000Z" }),
        );

        assert.deepEqual(created.unwrap("expected session create to succeed"), session);
        assert.deepEqual(fetched.unwrap("expected session lookup to succeed"), session);
        assert.deepEqual(updated.unwrap("expected session update to succeed"), {
          ...session,
          title: "Fix bug quickly",
          updatedAt: later,
        });
        assert.deepEqual(preservedTitle.unwrap("expected session update to succeed"), {
          ...session,
          title: "Fix bug quickly",
          updatedAt: "2026-05-08T10:10:00.000Z",
        });

        const deleted = yield* Effect.promise(() => store.sessions.delete(session.ref));
        const deletedAgain = yield* Effect.promise(() => store.sessions.delete(session.ref));
        const missing = yield* Effect.promise(() => store.sessions.get(session.ref));

        assert.isTrue(deleted.isOk());
        assert.isTrue(deletedAgain.isOk());
        assert.isNull(missing.unwrap("expected session lookup to succeed"));
      }),
    );
  }),
);

it.effect("duplicate session create and missing session update map to domain store errors", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        const duplicate = yield* Effect.promise(() => store.sessions.create(session));
        const missing = yield* Effect.promise(() =>
          store.sessions.update(
            { harnessId: "opencode", sessionId: "missing" },
            { updatedAt: later },
          ),
        );

        assert.isTrue(duplicate.isErr());
        assert.isTrue(duplicate.isErr() && StoreConflictError.is(duplicate.error));
        assert.isTrue(missing.isErr());
        assert.isTrue(missing.isErr() && StoreNotFoundError.is(missing.error));
      }),
    );
  }),
);

it.effect("thread bindings bind/get/delete and overwrite by chat thread", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        yield* Effect.promise(() => store.sessions.create(otherSession));

        const initialBinding = bindFor();
        const replacementBinding = bindFor({
          sessionRef: otherSession.ref,
          createdAt: later,
        });

        const bound = yield* Effect.promise(() => store.threadBindings.bind(initialBinding));
        const fetched = yield* Effect.promise(() => store.threadBindings.get(session.origin));
        const overwritten = yield* Effect.promise(() =>
          store.threadBindings.bind(replacementBinding),
        );
        const fetchedReplacement = yield* Effect.promise(() =>
          store.threadBindings.get(session.origin),
        );
        const deleted = yield* Effect.promise(() => store.threadBindings.delete(session.origin));
        const deletedAgain = yield* Effect.promise(() =>
          store.threadBindings.delete(session.origin),
        );
        const missing = yield* Effect.promise(() => store.threadBindings.get(session.origin));

        assert.isTrue(bound.isOk());
        assert.deepEqual(fetched.unwrap("expected binding lookup to succeed"), initialBinding);
        assert.isTrue(overwritten.isOk());
        assert.deepEqual(
          fetchedReplacement.unwrap("expected binding lookup to succeed"),
          replacementBinding,
        );
        assert.isTrue(deleted.isOk());
        assert.isTrue(deletedAgain.isOk());
        assert.isNull(missing.unwrap("expected binding lookup to succeed"));
      }),
    );
  }),
);

it.effect("thread binding deleteBySession removes only bindings for that session", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    const otherThread = { chatId: "telegram", threadId: "thread-2" };
    const unrelatedThread = { chatId: "telegram", threadId: "thread-3" };

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        yield* Effect.promise(() => store.sessions.create(otherSession));

        yield* Effect.promise(() => store.threadBindings.bind(bindFor()));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor({ thread: otherThread })));
        yield* Effect.promise(() =>
          store.threadBindings.bind(
            bindFor({ thread: unrelatedThread, sessionRef: otherSession.ref }),
          ),
        );

        const deleted = yield* Effect.promise(() =>
          store.threadBindings.deleteBySession(session.ref),
        );
        const first = yield* Effect.promise(() => store.threadBindings.get(session.origin));
        const second = yield* Effect.promise(() => store.threadBindings.get(otherThread));
        const unrelated = yield* Effect.promise(() => store.threadBindings.get(unrelatedThread));

        assert.isTrue(deleted.isOk());
        assert.isNull(first.unwrap("expected binding lookup to succeed"));
        assert.isNull(second.unwrap("expected binding lookup to succeed"));
        assert.deepEqual(
          unrelated.unwrap("expected binding lookup to succeed"),
          bindFor({ thread: unrelatedThread, sessionRef: otherSession.ref }),
        );
      }),
    );
  }),
);

it.effect("deleting a session removes thread bindings", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    const otherThread = { chatId: "telegram", threadId: "thread-2" };

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor()));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor({ thread: otherThread })));

        const deleted = yield* Effect.promise(() => store.sessions.delete(session.ref));
        const first = yield* Effect.promise(() => store.threadBindings.get(session.origin));
        const second = yield* Effect.promise(() => store.threadBindings.get(otherThread));

        assert.isTrue(deleted.isOk());
        assert.isNull(first.unwrap("expected binding lookup to succeed"));
        assert.isNull(second.unwrap("expected binding lookup to succeed"));
      }),
    );
  }),
);

it.effect("session delete does not rely on SQLite foreign-key cascade", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;
    const otherThread = { chatId: "telegram", threadId: "thread-2" };

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor()));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor({ thread: otherThread })));

        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe("PRAGMA foreign_keys = OFF").withoutTransform;

        const deleted = yield* Effect.promise(() => store.sessions.delete(session.ref));
        const first = yield* Effect.promise(() => store.threadBindings.get(session.origin));
        const second = yield* Effect.promise(() => store.threadBindings.get(otherThread));

        assert.isTrue(deleted.isOk());
        assert.isNull(first.unwrap("expected binding lookup to succeed"));
        assert.isNull(second.unwrap("expected binding lookup to succeed"));
      }),
    );
  }),
);

it.effect("workspaces set/get/delete mirror in-memory behavior with fresh returned objects", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        const set = yield* Effect.promise(() => store.workspaces.set(workspace));
        const fetched = yield* Effect.promise(() => store.workspaces.get(workspace.thread));
        const updatedWorkspace = {
          ...workspace,
          cwd: "/repo/packages/orchestrator",
          createdAt: "2026-05-08T10:01:00.000Z",
          updatedAt: later,
        } satisfies ThreadWorkspace;
        const updated = yield* Effect.promise(() => store.workspaces.set(updatedWorkspace));
        const fetchedAfterUpdate = yield* Effect.promise(() =>
          store.workspaces.get(workspace.thread),
        );

        const updatedValue = updated.unwrap("expected workspace update to succeed");
        const fetchedAfterUpdateValue = fetchedAfterUpdate.unwrap(
          "expected workspace lookup to succeed",
        );
        if (fetchedAfterUpdateValue === null) {
          assert.fail("expected workspace to exist after update");
        }

        assert.deepEqual(set.unwrap("expected workspace set to succeed"), workspace);
        assert.deepEqual(fetched.unwrap("expected workspace lookup to succeed"), workspace);
        assert.deepEqual(updatedValue, updatedWorkspace);
        assert.deepEqual(fetchedAfterUpdateValue, updatedWorkspace);
        assert.notStrictEqual(updatedValue, fetchedAfterUpdateValue);
        assert.notStrictEqual(updatedValue.thread, fetchedAfterUpdateValue.thread);

        const deleted = yield* Effect.promise(() => store.workspaces.delete(workspace.thread));
        const deletedAgain = yield* Effect.promise(() => store.workspaces.delete(workspace.thread));
        const missing = yield* Effect.promise(() => store.workspaces.get(workspace.thread));

        assert.isTrue(deleted.isOk());
        assert.isTrue(deletedAgain.isOk());
        assert.isNull(missing.unwrap("expected workspace lookup to succeed"));
      }),
    );
  }),
);

it.effect("store data survives closing and reopening the database", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => store.sessions.create(session));
        yield* Effect.promise(() => store.threadBindings.bind(bindFor()));
        yield* Effect.promise(() => store.workspaces.set(workspace));
      }),
    );

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        const fetchedSession = yield* Effect.promise(() => store.sessions.get(session.ref));
        const fetchedBinding = yield* Effect.promise(() =>
          store.threadBindings.get(session.origin),
        );
        const fetchedWorkspace = yield* Effect.promise(() =>
          store.workspaces.get(workspace.thread),
        );

        assert.deepEqual(fetchedSession.unwrap("expected session lookup to succeed"), session);
        assert.deepEqual(fetchedBinding.unwrap("expected binding lookup to succeed"), bindFor());
        assert.deepEqual(
          fetchedWorkspace.unwrap("expected workspace lookup to succeed"),
          workspace,
        );
      }),
    );
  }),
);

it.effect("binding to a missing session maps to StoreNotFoundError", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
      Effect.gen(function* () {
        const result = yield* Effect.promise(() => store.threadBindings.bind(bindFor()));

        assert.isTrue(result.isErr());
        assert.isTrue(result.isErr() && StoreNotFoundError.is(result.error));
      }),
    );
  }),
);

it.effect("invalid persisted row shapes map decode failures to StoreOperationError", () =>
  Effect.gen(function* () {
    const paths = yield* makePreparedPaths;

    yield* withStore(paths, (store) =>
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
            ${thirdSession.cwd},
            x'CAFE',
            ${thirdSession.createdAt},
            ${thirdSession.updatedAt}
          )
        `.withoutTransform;

        const result = yield* Effect.promise(() => store.sessions.get(thirdSession.ref));

        assert.isTrue(result.isErr());
        assert.isTrue(result.isErr() && StoreOperationError.is(result.error));
      }),
    );
  }),
);
