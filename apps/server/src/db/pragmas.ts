import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DatabaseStartupError } from "./errors";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const STARTUP_PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = WAL",
  `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
  "PRAGMA synchronous = NORMAL",
] as const;

const mapStartupFailure = (path: string, statement: string, cause: unknown): DatabaseStartupError =>
  DatabaseStartupError.make({
    path,
    message: `Failed to apply database PRAGMA: ${statement}`,
    cause,
  });

const unexpectedPragmaValue = (input: {
  readonly path: string;
  readonly pragma: string;
  readonly expected: string;
  readonly actual: string;
}): DatabaseStartupError =>
  DatabaseStartupError.make({
    path: input.path,
    message: `Unexpected database PRAGMA ${input.pragma}: expected ${input.expected}, got ${input.actual}`,
  });

const executePragma = (input: {
  readonly path: string;
  readonly statement: string;
}): Effect.Effect<void, DatabaseStartupError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(input.statement).withoutTransform.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => mapStartupFailure(input.path, input.statement, cause)),
      Effect.catchDefect((cause) =>
        Effect.fail(mapStartupFailure(input.path, input.statement, cause)),
      ),
    );
  });

type ForeignKeysPragmaRow = { readonly foreign_keys: number };
type JournalModePragmaRow = { readonly journal_mode: string };

const readPragma = <A extends object>(input: {
  readonly path: string;
  readonly statement: string;
}): Effect.Effect<ReadonlyArray<A>, DatabaseStartupError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.unsafe<A>(input.statement).withoutTransform.pipe(
      Effect.mapError((cause) => mapStartupFailure(input.path, input.statement, cause)),
      Effect.catchDefect((cause) =>
        Effect.fail(mapStartupFailure(input.path, input.statement, cause)),
      ),
    );
  });

const verifyPragmaRows = <A>(input: {
  readonly path: string;
  readonly statement: string;
  readonly rows: ReadonlyArray<A>;
  readonly readActual: (row: A) => string;
  readonly expected: string;
  readonly isExpected: (actual: string) => boolean;
}): Effect.Effect<string, DatabaseStartupError> => {
  const actual = input.rows[0] === undefined ? "<missing>" : input.readActual(input.rows[0]);
  return input.isExpected(actual)
    ? Effect.succeed(actual)
    : Effect.fail(
        unexpectedPragmaValue({
          path: input.path,
          pragma: input.statement,
          expected: input.expected,
          actual,
        }),
      );
};

const verifyDatabasePragmas = Effect.fn("server.db.verifyPragmas")(function* (path: string) {
  const foreignKeysRows = yield* readPragma<ForeignKeysPragmaRow>({
    path,
    statement: "PRAGMA foreign_keys",
  });
  const foreignKeys = yield* verifyPragmaRows({
    path,
    statement: "PRAGMA foreign_keys",
    rows: foreignKeysRows,
    readActual: (row) => String(row.foreign_keys),
    expected: "1",
    isExpected: (actual) => actual === "1",
  });

  const journalModeRows = yield* readPragma<JournalModePragmaRow>({
    path,
    statement: "PRAGMA journal_mode",
  });
  const journalMode = yield* verifyPragmaRows({
    path,
    statement: "PRAGMA journal_mode",
    rows: journalModeRows,
    readActual: (row) => row.journal_mode.toLowerCase(),
    expected: "wal",
    isExpected: (actual) => actual === "wal",
  });

  return { foreignKeys, journalMode };
});

/** Apply every per-connection/file PRAGMA needed before migrations run. */
export const applyDatabasePragmas = Effect.fn("server.db.applyPragmas")(function* (path: string) {
  yield* Effect.logInfo("applying database PRAGMAs", { path });
  for (const statement of STARTUP_PRAGMAS) {
    yield* executePragma({ path, statement });
  }
  const verified = yield* verifyDatabasePragmas(path);
  yield* Effect.logInfo("database PRAGMAs applied", {
    path,
    foreignKeys: verified.foreignKeys,
    journalMode: verified.journalMode,
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    synchronous: "NORMAL",
  });
});
