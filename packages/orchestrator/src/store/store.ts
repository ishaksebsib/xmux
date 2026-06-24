import { type Result } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type {
  ChatThreadRef,
  SessionRecord,
  SessionRecordPatch,
  ThreadBinding,
  ThreadWorkspace,
} from "./model";
import type { StoreConflictError, StoreNotFoundError, StoreOperationError } from "../errors";

export type StoreOperation = "create" | "read" | "update" | "delete";

/**
 * Durable package store.
 *
 * Implement this interface for Postgres, Redis, SQLite, or any other backend.
 * Handlers and services should depend on this contract rather than a concrete
 * implementation.
 */
export interface Store {
  readonly sessions: SessionStore;
  readonly threadBindings: ThreadBindingStore;
  readonly workspaces: WorkspaceStore;
}

/** Persistence operations for owned session metadata. */
export interface SessionStore {
  create(
    record: SessionRecord,
  ): Promise<Result<SessionRecord, StoreConflictError | StoreOperationError>>;
  get(ref: SessionRef): Promise<Result<SessionRecord | null, StoreOperationError>>;
  update(
    ref: SessionRef,
    patch: SessionRecordPatch,
  ): Promise<Result<SessionRecord, StoreNotFoundError | StoreOperationError>>;
  /** Deletes session metadata and all chat-thread bindings that point at it. */
  delete(ref: SessionRef): Promise<Result<void, StoreOperationError>>;
}

/** Persistence operations for chat-thread to harness-session routing. */
export interface ThreadBindingStore {
  /** Binds a chat thread to an existing session; dangling bindings are rejected. */
  bind(binding: ThreadBinding): Promise<Result<void, StoreNotFoundError | StoreOperationError>>;
  get(thread: ChatThreadRef): Promise<Result<ThreadBinding | null, StoreOperationError>>;
  delete(thread: ChatThreadRef): Promise<Result<void, StoreOperationError>>;
  deleteBySession(ref: SessionRef): Promise<Result<void, StoreOperationError>>;
}

/** Persistence operations for chat-thread workspace state. */
export interface WorkspaceStore {
  get(thread: ChatThreadRef): Promise<Result<ThreadWorkspace | null, StoreOperationError>>;
  set(workspace: ThreadWorkspace): Promise<Result<ThreadWorkspace, StoreOperationError>>;
  delete(thread: ChatThreadRef): Promise<Result<void, StoreOperationError>>;
}
