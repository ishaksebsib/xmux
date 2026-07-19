/** Stable migration ledger table used by the server database foundation. */
export const MIGRATIONS_TABLE = "xmux_migrations";
export const DB_METADATA_TABLE = "xmux_db_metadata";
export const DATABASE_FOUNDATION_MIGRATION = "0001_database_foundation";
/** Historical ledger entry retained so existing server ledgers remain compatible. */
export const ORCHESTRATOR_STORE_MIGRATION = "0002_orchestrator_store";
export const DATABASE_NAMESPACE_KEY = "schema_namespace";
export const DATABASE_NAMESPACE_VALUE = "xmux-server";

/** Legacy table names retained only for compatibility diagnostics and fixtures. */
export const ORCHESTRATOR_SESSION_TABLE = "orchestrator_session";
export const THREAD_BINDING_TABLE = "thread_binding";
export const THREAD_WORKSPACE_TABLE = "thread_workspace";
export const THREAD_BINDING_SESSION_INDEX = "thread_binding_session_idx";
