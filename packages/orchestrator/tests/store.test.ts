import { describe, expect, test } from "vitest";
import {
  createInMemoryStore,
  StoreConflictError,
  StoreNotFoundError,
  type SessionRecord,
  type ThreadBinding,
  type ThreadWorkspace,
} from "../src";

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
  createdAt: "2026-05-08T10:00:00.000Z",
  updatedAt: "2026-05-08T10:00:00.000Z",
} satisfies SessionRecord<"opencode", "telegram">;

describe("createInMemoryStore", () => {
  test("stores and updates session records", async () => {
    const store = createInMemoryStore();

    const created = await store.sessions.create(session);
    const fetched = await store.sessions.get(session.ref);
    const updated = await store.sessions.update(session.ref, {
      title: "Fix bug quickly",
      updatedAt: "2026-05-08T10:05:00.000Z",
    });

    expect(created.isOk()).toBe(true);
    expect(fetched.unwrap("expected session to exist")).toEqual(session);
    expect(updated.unwrap("expected session update to succeed")).toMatchObject({
      title: "Fix bug quickly",
      updatedAt: "2026-05-08T10:05:00.000Z",
    });
  });

  test("surfaces session conflict and missing update errors", async () => {
    const store = createInMemoryStore();

    await store.sessions.create(session);
    const duplicate = await store.sessions.create(session);
    const missing = await store.sessions.update(
      { harnessId: "opencode", sessionId: "missing" },
      { updatedAt: "2026-05-08T10:05:00.000Z" },
    );

    expect(duplicate.isErr()).toBe(true);
    expect(duplicate.isErr() && StoreConflictError.is(duplicate.error)).toBe(true);
    expect(missing.isErr()).toBe(true);
    expect(missing.isErr() && StoreNotFoundError.is(missing.error)).toBe(true);
  });

  test("stores thread bindings", async () => {
    const store = createInMemoryStore();
    const binding = {
      thread: session.origin,
      sessionRef: session.ref,
      createdAt: "2026-05-08T10:00:00.000Z",
    } satisfies ThreadBinding<"opencode", "telegram">;

    const bound = await store.threadBindings.bind(binding);
    const fetched = await store.threadBindings.get(session.origin);
    await store.threadBindings.delete(session.origin);
    const deleted = await store.threadBindings.get(session.origin);

    expect(bound.isOk()).toBe(true);
    expect(fetched.unwrap("expected binding to exist")).toEqual(binding);
    expect(deleted.unwrap("expected binding lookup to succeed")).toBeNull();
  });

  test("deletes all bindings for a session", async () => {
    const store = createInMemoryStore();
    const otherThread = { chatId: "telegram", threadId: "thread-2" } as const;
    const unrelatedThread = { chatId: "telegram", threadId: "thread-3" } as const;
    const unrelatedRef = { harnessId: "opencode", sessionId: "session-2" } as const;
    const now = "2026-05-08T10:00:00.000Z";

    await store.threadBindings.bind({
      thread: session.origin,
      sessionRef: session.ref,
      createdAt: now,
    });
    await store.threadBindings.bind({
      thread: otherThread,
      sessionRef: session.ref,
      createdAt: now,
    });
    await store.threadBindings.bind({
      thread: unrelatedThread,
      sessionRef: unrelatedRef,
      createdAt: now,
    });

    const deleted = await store.threadBindings.deleteBySession(session.ref);

    expect(deleted.isOk()).toBe(true);
    expect(
      (await store.threadBindings.get(session.origin)).unwrap("expected binding lookup to succeed"),
    ).toBeNull();
    expect(
      (await store.threadBindings.get(otherThread)).unwrap("expected binding lookup to succeed"),
    ).toBeNull();
    expect(
      (await store.threadBindings.get(unrelatedThread)).unwrap(
        "expected binding lookup to succeed",
      ),
    ).toMatchObject({ sessionRef: unrelatedRef });
  });

  test("deleting a session also deletes all of its thread bindings", async () => {
    const store = createInMemoryStore();
    const otherThread = { chatId: "telegram", threadId: "thread-2" } as const;
    const now = "2026-05-08T10:00:00.000Z";

    await store.sessions.create(session);
    await store.threadBindings.bind({
      thread: session.origin,
      sessionRef: session.ref,
      createdAt: now,
    });
    await store.threadBindings.bind({
      thread: otherThread,
      sessionRef: session.ref,
      createdAt: now,
    });

    const deleted = await store.sessions.delete(session.ref);

    expect(deleted.isOk()).toBe(true);
    expect(
      (await store.threadBindings.get(session.origin)).unwrap("expected binding lookup to succeed"),
    ).toBeNull();
    expect(
      (await store.threadBindings.get(otherThread)).unwrap("expected binding lookup to succeed"),
    ).toBeNull();
  });

  test("sets, updates, deletes, and clones thread workspaces", async () => {
    const store = createInMemoryStore();
    const workspace = {
      thread: { chatId: "telegram", threadId: "thread-1" },
      cwd: "/repo",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:00:00.000Z",
    } satisfies ThreadWorkspace<"telegram">;

    const set = await store.workspaces.set(workspace);
    const fetched = await store.workspaces.get(workspace.thread);
    const updated = await store.workspaces.set({
      ...workspace,
      cwd: "/repo/packages/orchestrator",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:05:00.000Z",
    });

    expect(set.unwrap("expected workspace set to succeed")).toEqual(workspace);
    expect(fetched.unwrap("expected workspace to exist")).toEqual(workspace);
    expect(updated.unwrap("expected workspace update to succeed")).toMatchObject({
      cwd: "/repo/packages/orchestrator",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:05:00.000Z",
    });

    const mutableFetched = updated.unwrap("expected workspace update to succeed") as {
      thread: { chatId: string; threadId: string };
      cwd: string;
    };
    mutableFetched.thread.threadId = "mutated";
    mutableFetched.cwd = "/mutated";

    const afterMutation = await store.workspaces.get(workspace.thread);
    expect(afterMutation.unwrap("expected workspace lookup to succeed")).toMatchObject({
      thread: { chatId: "telegram", threadId: "thread-1" },
      cwd: "/repo/packages/orchestrator",
    });

    await store.workspaces.delete(workspace.thread);
    const deleted = await store.workspaces.get(workspace.thread);

    expect(deleted.unwrap("expected workspace lookup to succeed")).toBeNull();
  });
});
