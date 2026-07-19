import { describe, expect, test } from "vitest";
import {
  type SessionRecord,
  type Store,
  type ThreadBinding,
  type ThreadWorkspace,
} from "@xmux/orchestrator";

export interface StoreContractSuiteInput {
  readonly name: string;
  readonly withStore: <A>(use: (store: Store) => Promise<A>) => Promise<A>;
}

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

const workspace = {
  thread: session.origin,
  cwd: "/repo",
  createdAt: now,
  updatedAt: now,
} satisfies ThreadWorkspace;

const sessionKey = (ref: SessionRecord["ref"]): string => `${ref.harnessId}:${ref.sessionId}`;

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;

const hasResource = (error: unknown, expected: string): boolean =>
  typeof error === "object" && error !== null && "resource" in error && error.resource === expected;

const hasId = (error: unknown, expected: string): boolean =>
  typeof error === "object" && error !== null && "id" in error && error.id === expected;

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

export function registerStoreContractTests(input: StoreContractSuiteInput): void {
  describe(input.name, () => {
    test("stores, updates, gets, and deletes sessions", async () => {
      await input.withStore(async (store) => {
        const created = await store.sessions.create(session);
        const fetched = await store.sessions.get(session.ref);
        const updated = await store.sessions.update(session.ref, {
          title: "Fix bug quickly",
          updatedAt: later,
        });
        const preservedTitle = await store.sessions.update(session.ref, {
          updatedAt: "2026-05-08T10:10:00.000Z",
        });

        expect(created.unwrap("expected session create to succeed")).toEqual(session);
        expect(fetched.unwrap("expected session lookup to succeed")).toEqual(session);
        expect(updated.unwrap("expected session update to succeed")).toEqual({
          ...session,
          title: "Fix bug quickly",
          updatedAt: later,
        });
        expect(preservedTitle.unwrap("expected session update to succeed")).toEqual({
          ...session,
          title: "Fix bug quickly",
          updatedAt: "2026-05-08T10:10:00.000Z",
        });

        const deleted = await store.sessions.delete(session.ref);
        const deletedAgain = await store.sessions.delete(session.ref);
        const missing = await store.sessions.get(session.ref);

        expect(deleted.isOk()).toBe(true);
        expect(deletedAgain.isOk()).toBe(true);
        expect(missing.unwrap("expected session lookup to succeed")).toBeNull();
      });
    });

    test("surfaces session conflict and missing update as typed domain errors", async () => {
      await input.withStore(async (store) => {
        await store.sessions.create(session);

        const duplicate = await store.sessions.create(session);
        const missing = await store.sessions.update(
          { harnessId: "opencode", sessionId: "missing" },
          { updatedAt: later },
        );

        expect(duplicate.isErr()).toBe(true);
        expect(duplicate.isErr() && hasErrorTag(duplicate.error, "StoreConflictError")).toBe(true);
        expect(missing.isErr()).toBe(true);
        expect(missing.isErr() && hasErrorTag(missing.error, "StoreNotFoundError")).toBe(true);
      });
    });

    test("requires a thread binding target session to exist", async () => {
      await input.withStore(async (store) => {
        const missing = await store.threadBindings.bind(bindFor());

        expect(missing.isErr()).toBe(true);
        expect(missing.isErr() && hasErrorTag(missing.error, "StoreNotFoundError")).toBe(true);
        expect(missing.isErr() && hasResource(missing.error, "session")).toBe(true);
        expect(missing.isErr() && hasId(missing.error, sessionKey(session.ref))).toBe(true);
      });
    });

    test("binds, gets, deletes, and overwrites thread bindings by chat thread", async () => {
      await input.withStore(async (store) => {
        await store.sessions.create(session);
        await store.sessions.create(otherSession);

        const initialBinding = bindFor();
        const replacementBinding = bindFor({
          sessionRef: otherSession.ref,
          createdAt: later,
        });

        const bound = await store.threadBindings.bind(initialBinding);
        const fetched = await store.threadBindings.get(session.origin);
        const overwritten = await store.threadBindings.bind(replacementBinding);
        const fetchedReplacement = await store.threadBindings.get(session.origin);
        const deleted = await store.threadBindings.delete(session.origin);
        const deletedAgain = await store.threadBindings.delete(session.origin);
        const missing = await store.threadBindings.get(session.origin);

        expect(bound.isOk()).toBe(true);
        expect(fetched.unwrap("expected binding lookup to succeed")).toEqual(initialBinding);
        expect(overwritten.isOk()).toBe(true);
        expect(fetchedReplacement.unwrap("expected binding lookup to succeed")).toEqual(
          replacementBinding,
        );
        expect(deleted.isOk()).toBe(true);
        expect(deletedAgain.isOk()).toBe(true);
        expect(missing.unwrap("expected binding lookup to succeed")).toBeNull();
      });
    });

    test("deleteBySession removes only bindings for that session", async () => {
      await input.withStore(async (store) => {
        const otherThread = { chatId: "telegram", threadId: "thread-2" };
        const unrelatedThread = { chatId: "telegram", threadId: "thread-3" };

        await store.sessions.create(session);
        await store.sessions.create(otherSession);
        await store.threadBindings.bind(bindFor());
        await store.threadBindings.bind(bindFor({ thread: otherThread }));
        await store.threadBindings.bind(
          bindFor({ thread: unrelatedThread, sessionRef: otherSession.ref }),
        );

        const deleted = await store.threadBindings.deleteBySession(session.ref);
        const first = await store.threadBindings.get(session.origin);
        const second = await store.threadBindings.get(otherThread);
        const unrelated = await store.threadBindings.get(unrelatedThread);

        expect(deleted.isOk()).toBe(true);
        expect(first.unwrap("expected binding lookup to succeed")).toBeNull();
        expect(second.unwrap("expected binding lookup to succeed")).toBeNull();
        expect(unrelated.unwrap("expected binding lookup to succeed")).toEqual(
          bindFor({ thread: unrelatedThread, sessionRef: otherSession.ref }),
        );
      });
    });

    test("deleting a session also removes all of its thread bindings", async () => {
      await input.withStore(async (store) => {
        const otherThread = { chatId: "telegram", threadId: "thread-2" };

        await store.sessions.create(session);
        await store.threadBindings.bind(bindFor());
        await store.threadBindings.bind(bindFor({ thread: otherThread }));

        const deleted = await store.sessions.delete(session.ref);
        const first = await store.threadBindings.get(session.origin);
        const second = await store.threadBindings.get(otherThread);

        expect(deleted.isOk()).toBe(true);
        expect(first.unwrap("expected binding lookup to succeed")).toBeNull();
        expect(second.unwrap("expected binding lookup to succeed")).toBeNull();
      });
    });

    test("sets, updates, gets, and deletes thread workspaces", async () => {
      await input.withStore(async (store) => {
        const set = await store.workspaces.set(workspace);
        const fetched = await store.workspaces.get(workspace.thread);
        const updatedWorkspace = {
          ...workspace,
          cwd: "/repo/packages/orchestrator",
          createdAt: "2026-05-08T10:01:00.000Z",
          updatedAt: later,
        } satisfies ThreadWorkspace;
        const updated = await store.workspaces.set(updatedWorkspace);
        const fetchedAfterUpdate = await store.workspaces.get(workspace.thread);

        const updatedValue = updated.unwrap("expected workspace update to succeed");
        const fetchedAfterUpdateValue = fetchedAfterUpdate.unwrap(
          "expected workspace lookup to succeed",
        );

        expect(set.unwrap("expected workspace set to succeed")).toEqual(workspace);
        expect(fetched.unwrap("expected workspace lookup to succeed")).toEqual(workspace);
        expect(updatedValue).toEqual(updatedWorkspace);
        expect(fetchedAfterUpdateValue).toEqual(updatedWorkspace);
        expect(updatedValue).not.toBe(fetchedAfterUpdateValue);
        expect(updatedValue.thread).not.toBe(fetchedAfterUpdateValue?.thread);

        const deleted = await store.workspaces.delete(workspace.thread);
        const deletedAgain = await store.workspaces.delete(workspace.thread);
        const missing = await store.workspaces.get(workspace.thread);

        expect(deleted.isOk()).toBe(true);
        expect(deletedAgain.isOk()).toBe(true);
        expect(missing.unwrap("expected workspace lookup to succeed")).toBeNull();
      });
    });
  });
}
