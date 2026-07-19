import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { StoreOperationError, type SessionRecord, type Store } from "@xmux/orchestrator";
import { afterEach, expect, test } from "vitest";
import { registerStoreContractTests } from "./support/store-contract";
import { createSqliteStore } from "../src";
import { migrate } from "../src/migrations";

const roots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xmux-store-sqlite-"));
  roots.push(root);
  return join(root, "xmux.db");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function withStore<A>(use: (store: Store) => Promise<A>): Promise<A> {
  const store = createSqliteStore({ path: await databasePath() });
  const initialized = await store.initialize();
  expect(initialized.isOk()).toBe(true);
  try {
    return await use(store);
  } finally {
    const closed = await store.close();
    expect(closed.isOk()).toBe(true);
  }
}

registerStoreContractTests({ name: "createSqliteStore", withStore });

const session = {
  ref: { harnessId: "opencode", sessionId: "session-1" },
  origin: { chatId: "telegram", threadId: "thread-1" },
  requester: { userId: "user-1", displayName: "Ishak" },
  cwd: "/repo",
  title: "Fix bug",
  createdAt: "2026-05-08T10:00:00.000Z",
  updatedAt: "2026-05-08T10:00:00.000Z",
} satisfies SessionRecord;

test("advanced migration API owns its client and path", async () => {
  const path = await databasePath();
  expect((await migrate({ path })).isOk()).toBe(true);
  const store = createSqliteStore({ path });
  expect((await store.initialize()).isOk()).toBe(true);
  expect((await store.close()).isOk()).toBe(true);
});

test("initialization is concurrent-safe and idempotent", async () => {
  const path = await databasePath();
  const store = createSqliteStore({ path });
  const results = await Promise.all(Array.from({ length: 16 }, () => store.initialize()));
  expect(results.every((result) => result.isOk())).toBe(true);
  expect((await store.initialize()).isOk()).toBe(true);
  expect((await store.close()).isOk()).toBe(true);

  const client = createClient({ url: new URL(`file:${path}`).href });
  const ledger = await client.execute(
    "SELECT migration_id, name FROM xmux_store_sqlite_migrations",
  );
  expect(ledger.rows).toHaveLength(1);
  client.close();
});

test("close is idempotent and a closed store never reopens", async () => {
  const store = createSqliteStore({ path: await databasePath() });
  expect((await store.close()).isOk()).toBe(true);
  expect((await store.close()).isOk()).toBe(true);
  expect((await store.initialize()).isErr()).toBe(true);
  const operation = await store.sessions.get(session.ref);
  expect(operation.isErr()).toBe(true);
  expect(operation.isErr() && StoreOperationError.is(operation.error)).toBe(true);
});

test("data persists after close and reopen", async () => {
  const path = await databasePath();
  const first = createSqliteStore({ path });
  expect((await first.initialize()).isOk()).toBe(true);
  expect((await first.sessions.create(session)).isOk()).toBe(true);
  expect((await first.close()).isOk()).toBe(true);

  const second = createSqliteStore({ path });
  expect((await second.initialize()).isOk()).toBe(true);
  expect((await second.sessions.get(session.ref)).unwrap("expected persisted session")).toEqual(
    session,
  );
  expect((await second.close()).isOk()).toBe(true);
});

test("malformed persisted rows fail through StoreOperationError", async () => {
  const path = await databasePath();
  const store = createSqliteStore({ path });
  expect((await store.initialize()).isOk()).toBe(true);
  const client = createClient({ url: new URL(`file:${path}`).href });
  await client.execute({
    sql: `INSERT INTO orchestrator_session (
      harness_id, session_id, origin_chat_id, origin_thread_id, requester_user_id,
      requester_display_name, cwd, title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, x'CAFE', NULL, ?, ?)`,
    args: ["pi", "corrupt", "discord", "thread", "user", session.createdAt, session.updatedAt],
  });
  client.close();

  const result = await store.sessions.get({ harnessId: "pi", sessionId: "corrupt" });
  expect(result.isErr()).toBe(true);
  expect(result.isErr() && StoreOperationError.is(result.error)).toBe(true);
  expect((await store.close()).isOk()).toBe(true);
});

test("multiple stores can concurrently adopt one database", async () => {
  const path = await databasePath();
  const stores = Array.from({ length: 8 }, () => createSqliteStore({ path }));
  const initialized = await Promise.all(stores.map((store) => store.initialize()));
  expect(
    initialized.every((result) => result.isOk()),
    initialized.map((result) => (result.isErr() ? result.error.message : "ok")).join("\n"),
  ).toBe(true);
  const creates = await Promise.all(stores.map((store) => store.sessions.create(session)));
  expect(creates.filter((result) => result.isOk())).toHaveLength(1);
  await Promise.all(stores.map((store) => store.close()));
});

test("failed migrations remain typed and do not write a ledger entry", async () => {
  const path = await databasePath();
  const probe = createClient({ url: new URL(`file:${path}`).href });
  await probe.execute("CREATE VIEW thread_binding AS SELECT 1 AS incompatible");
  probe.close();

  const store = createSqliteStore({ path });
  const initialized = await store.initialize();
  expect(initialized.isErr()).toBe(true);
  expect(initialized.isErr() && initialized.error._tag).toBe("StoreInitializationError");

  const inspect = createClient({ url: new URL(`file:${path}`).href });
  const ledger = await inspect.execute("SELECT migration_id FROM xmux_store_sqlite_migrations");
  expect(ledger.rows).toHaveLength(0);
  inspect.close();
  expect((await store.close()).isOk()).toBe(true);
});

test("adopts a legacy server schema and preserves its data", async () => {
  const path = await databasePath();
  const legacy = createClient({ url: new URL(`file:${path}`).href });
  await legacy.executeMultiple(`
    CREATE TABLE xmux_migrations (
      migration_id INTEGER PRIMARY KEY NOT NULL,
      created_at DATETIME NOT NULL DEFAULT current_timestamp,
      name VARCHAR(255) NOT NULL
    );
    INSERT INTO xmux_migrations (migration_id, name)
      VALUES (1, 'database_foundation'), (2, 'orchestrator_store');
    CREATE TABLE xmux_db_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO xmux_db_metadata (key, value, updated_at)
      VALUES ('schema_namespace', 'xmux-server', '2026-05-08T10:00:00.000Z');
    CREATE TABLE orchestrator_session (
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
    );
    CREATE TABLE thread_binding (
      chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
      thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
      harness_id TEXT NOT NULL CHECK (length(harness_id) > 0),
      session_id TEXT NOT NULL CHECK (length(session_id) > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      PRIMARY KEY (chat_id, thread_id),
      FOREIGN KEY (harness_id, session_id)
        REFERENCES orchestrator_session(harness_id, session_id) ON DELETE CASCADE
    );
    CREATE INDEX thread_binding_session_idx
      ON thread_binding (harness_id, session_id);
    CREATE TABLE thread_workspace (
      chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
      thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
      cwd TEXT NOT NULL CHECK (length(cwd) > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      PRIMARY KEY (chat_id, thread_id)
    );
  `);
  await legacy.execute({
    sql: `INSERT INTO orchestrator_session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      session.ref.harnessId,
      session.ref.sessionId,
      session.origin.chatId,
      session.origin.threadId,
      session.requester.userId,
      session.requester.displayName ?? null,
      session.cwd,
      session.title ?? null,
      session.createdAt,
      session.updatedAt,
    ],
  });
  await legacy.execute({
    sql: "INSERT INTO thread_binding VALUES (?, ?, ?, ?, ?)",
    args: [
      session.origin.chatId,
      session.origin.threadId,
      session.ref.harnessId,
      session.ref.sessionId,
      session.createdAt,
    ],
  });
  await legacy.execute({
    sql: "INSERT INTO thread_workspace VALUES (?, ?, ?, ?, ?)",
    args: [
      session.origin.chatId,
      session.origin.threadId,
      session.cwd,
      session.createdAt,
      session.updatedAt,
    ],
  });
  legacy.close();

  const store = createSqliteStore({ path });
  expect((await store.initialize()).isOk()).toBe(true);
  expect((await store.sessions.get(session.ref)).unwrap("expected legacy session")).toEqual(
    session,
  );
  expect(
    (await store.threadBindings.get(session.origin)).unwrap("expected legacy binding"),
  ).toEqual({
    thread: session.origin,
    sessionRef: session.ref,
    createdAt: session.createdAt,
  });
  expect((await store.workspaces.get(session.origin)).unwrap("expected legacy workspace")).toEqual({
    thread: session.origin,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
  expect((await store.close()).isOk()).toBe(true);
  const inspect = createClient({ url: new URL(`file:${path}`).href });
  const serverLedger = await inspect.execute(
    "SELECT migration_id, name FROM xmux_migrations ORDER BY migration_id",
  );
  expect(
    serverLedger.rows.map((row) => [Reflect.get(row, "migration_id"), Reflect.get(row, "name")]),
  ).toEqual([
    [1, "database_foundation"],
    [2, "orchestrator_store"],
  ]);
  const packageLedger = await inspect.execute(
    "SELECT migration_id, name FROM xmux_store_sqlite_migrations",
  );
  expect(packageLedger.rows).toHaveLength(1);
  inspect.close();
});

test("creates the required schema, constraints, foreign key, and index", async () => {
  const path = await databasePath();
  const store = createSqliteStore({ path });
  expect((await store.initialize()).isOk()).toBe(true);
  const inspect = createClient({ url: new URL(`file:${path}`).href });

  const sessions = await inspect.execute("PRAGMA table_info(orchestrator_session)");
  expect(
    sessions.rows.map((row) => ({
      name: Reflect.get(row, "name"),
      notNull: Reflect.get(row, "notnull"),
      primaryKey: Reflect.get(row, "pk"),
    })),
  ).toEqual([
    { name: "harness_id", notNull: 1, primaryKey: 1 },
    { name: "session_id", notNull: 1, primaryKey: 2 },
    { name: "origin_chat_id", notNull: 1, primaryKey: 0 },
    { name: "origin_thread_id", notNull: 1, primaryKey: 0 },
    { name: "requester_user_id", notNull: 1, primaryKey: 0 },
    { name: "requester_display_name", notNull: 0, primaryKey: 0 },
    { name: "cwd", notNull: 1, primaryKey: 0 },
    { name: "title", notNull: 0, primaryKey: 0 },
    { name: "created_at", notNull: 1, primaryKey: 0 },
    { name: "updated_at", notNull: 1, primaryKey: 0 },
  ]);

  const foreignKeys = await inspect.execute("PRAGMA foreign_key_list(thread_binding)");
  expect(
    foreignKeys.rows.map((row) => ({
      from: Reflect.get(row, "from"),
      to: Reflect.get(row, "to"),
      table: Reflect.get(row, "table"),
      onDelete: Reflect.get(row, "on_delete"),
    })),
  ).toEqual([
    {
      from: "harness_id",
      to: "harness_id",
      table: "orchestrator_session",
      onDelete: "CASCADE",
    },
    {
      from: "session_id",
      to: "session_id",
      table: "orchestrator_session",
      onDelete: "CASCADE",
    },
  ]);
  const index = await inspect.execute("PRAGMA index_info(thread_binding_session_idx)");
  expect(index.rows.map((row) => Reflect.get(row, "name"))).toEqual(["harness_id", "session_id"]);
  const schema = await inspect.execute(
    "SELECT sql FROM sqlite_master WHERE name = 'orchestrator_session'",
  );
  expect(String(Reflect.get(schema.rows[0] ?? {}, "sql"))).toContain(
    "CHECK (length(harness_id) > 0)",
  );
  inspect.close();
  expect((await store.close()).isOk()).toBe(true);
});

test("rejects incompatible pre-existing tables without recording adoption", async () => {
  const path = await databasePath();
  const probe = createClient({ url: new URL(`file:${path}`).href });
  await probe.execute("CREATE TABLE orchestrator_session (id TEXT PRIMARY KEY)");
  probe.close();

  const store = createSqliteStore({ path });
  const initialized = await store.initialize();
  expect(initialized.isErr()).toBe(true);
  const inspect = createClient({ url: new URL(`file:${path}`).href });
  const ledger = await inspect.execute("SELECT migration_id FROM xmux_store_sqlite_migrations");
  expect(ledger.rows).toHaveLength(0);
  inspect.close();
  expect((await store.close()).isOk()).toBe(true);
});

test("duplicate persisted lookup rows fail diagnostically", async () => {
  const path = await databasePath();
  const store = createSqliteStore({ path });
  expect((await store.initialize()).isOk()).toBe(true);
  const corrupt = createClient({ url: new URL(`file:${path}`).href });
  await corrupt.execute("PRAGMA foreign_keys = OFF");
  await corrupt.execute("DROP TABLE thread_binding");
  await corrupt.execute("DROP TABLE orchestrator_session");
  await corrupt.execute(`CREATE TABLE orchestrator_session (
    harness_id TEXT NOT NULL, session_id TEXT NOT NULL, origin_chat_id TEXT NOT NULL,
    origin_thread_id TEXT NOT NULL, requester_user_id TEXT NOT NULL,
    requester_display_name TEXT NULL, cwd TEXT NOT NULL, title TEXT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const values = [
    session.ref.harnessId,
    session.ref.sessionId,
    session.origin.chatId,
    session.origin.threadId,
    session.requester.userId,
    session.requester.displayName ?? null,
    session.cwd,
    session.title ?? null,
    session.createdAt,
    session.updatedAt,
  ];
  await corrupt.execute({
    sql: "INSERT INTO orchestrator_session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: values,
  });
  await corrupt.execute({
    sql: "INSERT INTO orchestrator_session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: values,
  });
  corrupt.close();

  const result = await store.sessions.get(session.ref);
  expect(result.isErr()).toBe(true);
  expect(result.isErr() && StoreOperationError.is(result.error)).toBe(true);
  expect(result.isErr() && result.error.message).toContain("expected 0 or 1");
  expect((await store.close()).isOk()).toBe(true);
});

test("database checks reject invalid critical values", async () => {
  const store = createSqliteStore({ path: await databasePath() });
  expect((await store.initialize()).isOk()).toBe(true);
  const invalidSession = await store.sessions.create({
    ...session,
    ref: { ...session.ref, sessionId: "" },
  });
  expect(invalidSession.isErr()).toBe(true);
  expect(invalidSession.isErr() && StoreOperationError.is(invalidSession.error)).toBe(true);
  if (invalidSession.isErr()) expect("run" in invalidSession.error).toBe(false);
  expect((await store.sessions.create(session)).isOk()).toBe(true);
  const invalidBinding = await store.threadBindings.bind({
    thread: { chatId: "", threadId: "thread" },
    sessionRef: session.ref,
    createdAt: session.createdAt,
  });
  expect(invalidBinding.isErr()).toBe(true);
  const invalidWorkspace = await store.workspaces.set({
    thread: session.origin,
    cwd: "",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
  expect(invalidWorkspace.isErr()).toBe(true);
  expect((await store.close()).isOk()).toBe(true);
});

test("concurrent binding and workspace writes leave coherent rows", async () => {
  const store = createSqliteStore({ path: await databasePath() });
  expect((await store.initialize()).isOk()).toBe(true);
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    ...session,
    ref: { harnessId: "opencode", sessionId: `session-${index}` },
    origin: { chatId: "telegram", threadId: `origin-${index}` },
  })) satisfies readonly SessionRecord[];
  await Promise.all(sessions.map((record) => store.sessions.create(record)));
  const thread = { chatId: "telegram", threadId: "shared" };
  const bindings = sessions.map((record, index) => ({
    thread,
    sessionRef: record.ref,
    createdAt: `2026-05-08T10:${String(index).padStart(2, "0")}:00.000Z`,
  }));
  const workspaces = sessions.map((_, index) => ({
    thread,
    cwd: `/repo/${index}`,
    createdAt: session.createdAt,
    updatedAt: `2026-05-08T11:${String(index).padStart(2, "0")}:00.000Z`,
  }));
  expect(
    (await Promise.all(bindings.map((binding) => store.threadBindings.bind(binding)))).every(
      (result) => result.isOk(),
    ),
  ).toBe(true);
  expect(
    (await Promise.all(workspaces.map((workspace) => store.workspaces.set(workspace)))).every(
      (result) => result.isOk(),
    ),
  ).toBe(true);
  const binding = (await store.threadBindings.get(thread)).unwrap("expected binding");
  const workspace = (await store.workspaces.get(thread)).unwrap("expected workspace");
  expect(bindings).toContainEqual(binding);
  expect(workspaces).toContainEqual(workspace);
  expect((await store.close()).isOk()).toBe(true);
});

test("bind and update races with delete leave no dangling state", async () => {
  const store = createSqliteStore({ path: await databasePath() });
  expect((await store.initialize()).isOk()).toBe(true);
  expect((await store.sessions.create(session)).isOk()).toBe(true);
  const [binding] = await Promise.all([
    store.threadBindings.bind({
      thread: session.origin,
      sessionRef: session.ref,
      createdAt: session.createdAt,
    }),
    store.sessions.delete(session.ref),
  ]);
  if (binding.isErr()) expect(binding.error._tag).toBe("StoreNotFoundError");
  expect((await store.sessions.get(session.ref)).unwrap("expected lookup")).toBeNull();
  expect((await store.threadBindings.get(session.origin)).unwrap("expected lookup")).toBeNull();

  expect((await store.sessions.create(session)).isOk()).toBe(true);
  const [updated] = await Promise.all([
    store.sessions.update(session.ref, { title: "raced", updatedAt: session.updatedAt }),
    store.sessions.delete(session.ref),
  ]);
  if (updated.isErr()) expect(updated.error._tag).toBe("StoreNotFoundError");
  expect((await store.sessions.get(session.ref)).unwrap("expected lookup")).toBeNull();
  expect((await store.close()).isOk()).toBe(true);
});

test("invalid options fail during initialization without synchronous I/O", async () => {
  const store = createSqliteStore({ path: "", busyTimeoutMs: -1 });
  const result = await store.initialize();
  expect(result.isErr()).toBe(true);
  expect(result.isErr() && result.error._tag).toBe("StoreInitializationError");
});
