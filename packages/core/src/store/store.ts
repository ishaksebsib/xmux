import { type Result } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type { ChatThreadRef, SessionRecord, SessionRecordPatch, ThreadBinding } from "../model";
import type { StoreConflictError, StoreNotFoundError, StoreOperationError } from "../errors";

export type StoreOperation = "create" | "read" | "update" | "delete";

/**
 * Durable xmux package store.
 *
 * Implement this interface for Postgres, Redis, SQLite, or any other backend.
 * Handlers and services should depend on this contract rather than a concrete
 * implementation.
 */
export interface XmuxStore {
  readonly sessions: SessionStore;
  readonly threadBindings: ThreadBindingStore;
}

/** Persistence operations for xmux-owned session metadata. */
export interface SessionStore {
  create(
    record: SessionRecord,
  ): Promise<Result<SessionRecord, StoreConflictError | StoreOperationError>>;
  get(ref: SessionRef): Promise<Result<SessionRecord | null, StoreOperationError>>;
  update(
    ref: SessionRef,
    patch: SessionRecordPatch,
  ): Promise<Result<SessionRecord, StoreNotFoundError | StoreOperationError>>;
  delete(ref: SessionRef): Promise<Result<void, StoreOperationError>>;
}

/** Persistence operations for chat-thread to harness-session routing. */
export interface ThreadBindingStore {
  bind(binding: ThreadBinding): Promise<Result<void, StoreOperationError>>;
  get(thread: ChatThreadRef): Promise<Result<ThreadBinding | null, StoreOperationError>>;
  delete(thread: ChatThreadRef): Promise<Result<void, StoreOperationError>>;
}
