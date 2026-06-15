import { Result } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type { ChatThreadRef, SessionRecord, ThreadBinding, ThreadWorkspace } from "./model";
import { type Store } from "./store";
import { StoreConflictError, StoreNotFoundError } from "../errors";

/** Creates an in-memory store. */
export function createInMemoryStore(): Store {
  const sessions = new Map<string, SessionRecord>();
  const threadBindings = new Map<string, ThreadBinding>();
  const workspaces = new Map<string, ThreadWorkspace>();

  return {
    sessions: {
      async create(record) {
        const key = sessionKey(record.ref);
        if (sessions.has(key)) {
          return Result.err(new StoreConflictError({ resource: "session", id: key }));
        }

        const stored = cloneSession(record);
        sessions.set(key, stored);

        return Result.ok(cloneSession(stored));
      },

      async get(ref) {
        const record = sessions.get(sessionKey(ref));
        return Result.ok(record ? cloneSession(record) : null);
      },

      async update(ref, patch) {
        const key = sessionKey(ref);
        const existing = sessions.get(key);
        if (!existing) {
          return Result.err(new StoreNotFoundError({ resource: "session", id: key }));
        }

        const updated = cloneSession({
          ...existing,
          ...patch,
          ref: existing.ref,
          origin: existing.origin,
          requester: existing.requester,
        });

        sessions.set(key, updated);

        return Result.ok(cloneSession(updated));
      },

      async delete(ref) {
        sessions.delete(sessionKey(ref));
        return Result.ok();
      },
    },

    threadBindings: {
      async bind(binding) {
        threadBindings.set(threadKey(binding.thread), cloneBinding(binding));
        return Result.ok();
      },

      async get(thread) {
        const binding = threadBindings.get(threadKey(thread));
        return Result.ok(binding ? cloneBinding(binding) : null);
      },

      async delete(thread) {
        threadBindings.delete(threadKey(thread));
        return Result.ok();
      },
    },

    workspaces: {
      async get(thread) {
        const workspace = workspaces.get(threadKey(thread));
        return Result.ok(workspace ? cloneWorkspace(workspace) : null);
      },

      async set(workspace) {
        const stored = cloneWorkspace(workspace);
        workspaces.set(threadKey(workspace.thread), stored);
        return Result.ok(cloneWorkspace(stored));
      },

      async delete(thread) {
        workspaces.delete(threadKey(thread));
        return Result.ok();
      },
    },
  };
}

function sessionKey(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

function threadKey(thread: ChatThreadRef): string {
  return `${thread.chatId}:${thread.threadId}`;
}

function cloneSession(record: SessionRecord): SessionRecord {
  return {
    ...record,
    ref: { ...record.ref },
    origin: { ...record.origin },
    requester: { ...record.requester },
  };
}

function cloneBinding(binding: ThreadBinding): ThreadBinding {
  return {
    ...binding,
    thread: { ...binding.thread },
    sessionRef: { ...binding.sessionRef },
  };
}

function cloneWorkspace(workspace: ThreadWorkspace): ThreadWorkspace {
  return {
    ...workspace,
    thread: { ...workspace.thread },
  };
}
