/** Stable migration ledger table used by Effect SQL migrator. */
export const MIGRATIONS_TABLE = "xmux_migrations";

/** Generic DB health/metadata table; domain tables belong to later phases. */
export const DB_METADATA_TABLE = "xmux_db_metadata";

export const DATABASE_FOUNDATION_MIGRATION = "0001_database_foundation";
export const DATABASE_NAMESPACE_KEY = "schema_namespace";
export const DATABASE_NAMESPACE_VALUE = "xmux-server";
