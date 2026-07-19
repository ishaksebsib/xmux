import type { SessionRecord, ThreadBinding, ThreadWorkspace } from "@xmux/orchestrator";
import { Result, type Result as ResultType } from "better-result";
import { SqliteRowDecodeError } from "./errors";

type DecodeResult<A> = ResultType<A, SqliteRowDecodeError>;

function column(row: unknown, name: string): unknown {
  return typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof ArrayBuffer) return "binary";
  return typeof value;
}

function stringColumn(row: unknown, name: string): DecodeResult<string> {
  const value = column(row, name);
  return typeof value === "string" && value.length > 0
    ? Result.ok(value)
    : Result.err(
        new SqliteRowDecodeError({
          column: name,
          expected: "non-empty text",
          cause: valueKind(value),
        }),
      );
}

function nullableStringColumn(row: unknown, name: string): DecodeResult<string | null> {
  const value = column(row, name);
  return value === null || typeof value === "string"
    ? Result.ok(value)
    : Result.err(
        new SqliteRowDecodeError({
          column: name,
          expected: "text or null",
          cause: valueKind(value),
        }),
      );
}

export function sessionRowToRecord(row: unknown): DecodeResult<SessionRecord> {
  return Result.gen(function* () {
    const harnessId = yield* stringColumn(row, "harness_id");
    const sessionId = yield* stringColumn(row, "session_id");
    const chatId = yield* stringColumn(row, "origin_chat_id");
    const threadId = yield* stringColumn(row, "origin_thread_id");
    const userId = yield* stringColumn(row, "requester_user_id");
    const displayName = yield* nullableStringColumn(row, "requester_display_name");
    const cwd = yield* stringColumn(row, "cwd");
    const title = yield* nullableStringColumn(row, "title");
    const createdAt = yield* stringColumn(row, "created_at");
    const updatedAt = yield* stringColumn(row, "updated_at");

    return Result.ok({
      ref: { harnessId, sessionId },
      origin: { chatId, threadId },
      requester: displayName === null ? { userId } : { userId, displayName },
      cwd,
      ...(title === null ? {} : { title }),
      createdAt,
      updatedAt,
    });
  });
}

export function threadBindingRowToBinding(row: unknown): DecodeResult<ThreadBinding> {
  return Result.gen(function* () {
    const chatId = yield* stringColumn(row, "chat_id");
    const threadId = yield* stringColumn(row, "thread_id");
    const harnessId = yield* stringColumn(row, "harness_id");
    const sessionId = yield* stringColumn(row, "session_id");
    const createdAt = yield* stringColumn(row, "created_at");
    return Result.ok({
      thread: { chatId, threadId },
      sessionRef: { harnessId, sessionId },
      createdAt,
    });
  });
}

export function threadWorkspaceRowToWorkspace(row: unknown): DecodeResult<ThreadWorkspace> {
  return Result.gen(function* () {
    const chatId = yield* stringColumn(row, "chat_id");
    const threadId = yield* stringColumn(row, "thread_id");
    const cwd = yield* stringColumn(row, "cwd");
    const createdAt = yield* stringColumn(row, "created_at");
    const updatedAt = yield* stringColumn(row, "updated_at");
    return Result.ok({ thread: { chatId, threadId }, cwd, createdAt, updatedAt });
  });
}
