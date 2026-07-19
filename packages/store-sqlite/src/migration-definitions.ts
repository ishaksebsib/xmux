import {
  ORCHESTRATOR_SESSION_TABLE,
  THREAD_BINDING_SESSION_INDEX,
  THREAD_BINDING_TABLE,
  THREAD_WORKSPACE_TABLE,
} from "./schema";

export interface SqliteMigration {
  readonly id: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const createStoreSchema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${ORCHESTRATOR_SESSION_TABLE} (
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
  )`,
  `CREATE TABLE IF NOT EXISTS ${THREAD_BINDING_TABLE} (
    chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
    thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
    harness_id TEXT NOT NULL CHECK (length(harness_id) > 0),
    session_id TEXT NOT NULL CHECK (length(session_id) > 0),
    created_at TEXT NOT NULL CHECK (length(created_at) > 0),
    PRIMARY KEY (chat_id, thread_id),
    FOREIGN KEY (harness_id, session_id)
      REFERENCES ${ORCHESTRATOR_SESSION_TABLE}(harness_id, session_id)
      ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS ${THREAD_BINDING_SESSION_INDEX}
    ON ${THREAD_BINDING_TABLE} (harness_id, session_id)`,
  `CREATE TABLE IF NOT EXISTS ${THREAD_WORKSPACE_TABLE} (
    chat_id TEXT NOT NULL CHECK (length(chat_id) > 0),
    thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
    cwd TEXT NOT NULL CHECK (length(cwd) > 0),
    created_at TEXT NOT NULL CHECK (length(created_at) > 0),
    updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
    PRIMARY KEY (chat_id, thread_id)
  )`,
];

/** Ordered, append-only migrations owned by this package. */
export const migrations: readonly SqliteMigration[] = Object.freeze([
  Object.freeze({ id: 1, name: "orchestrator_store", statements: createStoreSchema }),
]);
