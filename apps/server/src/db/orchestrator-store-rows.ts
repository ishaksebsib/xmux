import type { SessionRecord, ThreadBinding, ThreadWorkspace } from "@xmux/orchestrator";
import { Schema } from "effect";

const NonEmptyText = Schema.NonEmptyString;

export class SessionRow extends Schema.Class<SessionRow>("SessionRow")({
  harness_id: NonEmptyText,
  session_id: NonEmptyText,
  origin_chat_id: NonEmptyText,
  origin_thread_id: NonEmptyText,
  requester_user_id: NonEmptyText,
  requester_display_name: Schema.NullOr(Schema.String),
  cwd: NonEmptyText,
  title: Schema.NullOr(Schema.String),
  created_at: NonEmptyText,
  updated_at: NonEmptyText,
}) {}

export class ThreadBindingRow extends Schema.Class<ThreadBindingRow>("ThreadBindingRow")({
  chat_id: NonEmptyText,
  thread_id: NonEmptyText,
  harness_id: NonEmptyText,
  session_id: NonEmptyText,
  created_at: NonEmptyText,
}) {}

export class ThreadWorkspaceRow extends Schema.Class<ThreadWorkspaceRow>("ThreadWorkspaceRow")({
  chat_id: NonEmptyText,
  thread_id: NonEmptyText,
  cwd: NonEmptyText,
  created_at: NonEmptyText,
  updated_at: NonEmptyText,
}) {}

export const decodeSessionRows = Schema.decodeUnknownEffect(Schema.Array(SessionRow));
export const decodeThreadBindingRows = Schema.decodeUnknownEffect(Schema.Array(ThreadBindingRow));
export const decodeThreadWorkspaceRows = Schema.decodeUnknownEffect(
  Schema.Array(ThreadWorkspaceRow),
);

export const sessionRowToRecord = (row: SessionRow): SessionRecord => ({
  ref: {
    harnessId: row.harness_id,
    sessionId: row.session_id,
  },
  origin: {
    chatId: row.origin_chat_id,
    threadId: row.origin_thread_id,
  },
  requester:
    row.requester_display_name === null
      ? { userId: row.requester_user_id }
      : { userId: row.requester_user_id, displayName: row.requester_display_name },
  cwd: row.cwd,
  ...(row.title === null ? {} : { title: row.title }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const threadBindingRowToBinding = (row: ThreadBindingRow): ThreadBinding => ({
  thread: {
    chatId: row.chat_id,
    threadId: row.thread_id,
  },
  sessionRef: {
    harnessId: row.harness_id,
    sessionId: row.session_id,
  },
  createdAt: row.created_at,
});

export const threadWorkspaceRowToWorkspace = (row: ThreadWorkspaceRow): ThreadWorkspace => ({
  thread: {
    chatId: row.chat_id,
    threadId: row.thread_id,
  },
  cwd: row.cwd,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
