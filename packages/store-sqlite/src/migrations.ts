import { createClient, type Client } from "@libsql/client";
import { Result, type Result as ResultType } from "better-result";
import { pathToFileURL } from "node:url";
import {
  SqliteConfigurationError,
  SqliteMigrationClientError,
  type SqliteMigrationError,
} from "./errors";
import { migrateClient } from "./migration-engine";
export { migrations, type SqliteMigration } from "./migration-definitions";
export { SqliteMigrationClientError, SqliteMigrationError } from "./errors";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export interface MigrateOptions {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}

export type MigrateError = SqliteMigrationError | SqliteMigrationClientError;

/**
 * Opens, migrates, and closes a SQLite database. This advanced API owns its
 * temporary client; normal consumers should rely on the Store lifecycle.
 */
export async function migrate(options: MigrateOptions): Promise<ResultType<void, MigrateError>> {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  let client: Client | undefined;
  const opened = await Result.tryPromise({
    try: async () => {
      if (options.path.length === 0) {
        throw new SqliteConfigurationError({ field: "path", reason: "must not be empty" });
      }
      if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
        throw new SqliteConfigurationError({
          field: "busyTimeoutMs",
          reason: "must be a non-negative safe integer",
        });
      }
      const databaseId = pathToFileURL(options.path).href;
      const created = createClient({ url: databaseId });
      client = created;
      await created.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      return { client: created, databaseId };
    },
    catch: (cause) =>
      new SqliteMigrationClientError({ path: options.path, operation: "open", cause }),
  });
  if (opened.isErr()) {
    if (client === undefined) return Result.err(opened.error);
    const cleanupClient = client;
    const cleanup = Result.try({
      try: () => cleanupClient.close(),
      catch: (cause) =>
        new SqliteMigrationClientError({ path: options.path, operation: "close", cause }),
    });
    return cleanup.isOk()
      ? Result.err(opened.error)
      : Result.err(
          new SqliteMigrationClientError({
            path: options.path,
            operation: "close",
            cause: new AggregateError([opened.error, cleanup.error], "Open and cleanup failed"),
          }),
        );
  }

  const migrated = await migrateClient(opened.value.client, {
    path: options.path,
    databaseId: opened.value.databaseId,
  });
  const closed = Result.try({
    try: () => opened.value.client.close(),
    catch: (cause) =>
      new SqliteMigrationClientError({ path: options.path, operation: "close", cause }),
  });

  if (migrated.isErr() && closed.isErr()) {
    return Result.err(
      new SqliteMigrationClientError({
        path: options.path,
        operation: "close",
        cause: new AggregateError([migrated.error, closed.error], "Migration and close failed"),
      }),
    );
  }
  if (migrated.isErr()) return migrated;
  return closed;
}
