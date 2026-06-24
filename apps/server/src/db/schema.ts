/** Stable migration ledger table used by Effect SQL migrator. */
export const MIGRATIONS_TABLE = "xmux_migrations";

/** Generic DB health/metadata table owned by the server database foundation. */
export const DB_METADATA_TABLE = "xmux_db_metadata";

/** Durable orchestrator session metadata table. */
export const ORCHESTRATOR_SESSION_TABLE = "orchestrator_session";

/** Chat-thread to orchestrator session routing table. */
export const THREAD_BINDING_TABLE = "thread_binding";

/** Per-chat-thread workspace state table. */
export const THREAD_WORKSPACE_TABLE = "thread_workspace";

export const DATABASE_FOUNDATION_MIGRATION = "0001_database_foundation";
export const ORCHESTRATOR_STORE_MIGRATION = "0002_orchestrator_store";
export const DATABASE_NAMESPACE_KEY = "schema_namespace";
export const DATABASE_NAMESPACE_VALUE = "xmux-server";
