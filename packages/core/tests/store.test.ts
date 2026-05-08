import { describe, expect, test } from "vitest";
import {
  createInMemoryStore,
  StoreConflictError,
  StoreNotFoundError,
  type SessionRecord,
  type ThreadBinding,
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
  deliveryMode: "requester_only",
  status: "open",
  createdAt: "2026-05-08T10:00:00.000Z",
  updatedAt: "2026-05-08T10:00:00.000Z",
} satisfies SessionRecord<"opencode", "telegram">;

describe("createInMemoryStore", () => {
  test("stores and updates session records", async () => {
    const store = createInMemoryStore();

    const created = await store.sessions.create(session);
    const fetched = await store.sessions.get(session.ref);
    const updated = await store.sessions.update(session.ref, {
      status: "closed",
      updatedAt: "2026-05-08T10:05:00.000Z",
      closedAt: "2026-05-08T10:05:00.000Z",
    });

    expect(created.isOk()).toBe(true);
    expect(fetched.unwrap("expected session to exist")).toEqual(session);
    expect(updated.unwrap("expected session update to succeed")).toMatchObject({
      status: "closed",
      closedAt: "2026-05-08T10:05:00.000Z",
    });
  });

  test("surfaces session conflict and missing update errors", async () => {
    const store = createInMemoryStore();

    await store.sessions.create(session);
    const duplicate = await store.sessions.create(session);
    const missing = await store.sessions.update(
      { harnessId: "opencode", sessionId: "missing" },
      { status: "closed", updatedAt: "2026-05-08T10:05:00.000Z" },
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
});
