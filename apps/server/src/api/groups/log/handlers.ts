import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LogReader } from "../../../logging/log-reader";
import { RuntimePaths } from "../../../runtime-state/runtime-paths-service";
import { serverApi } from "../../api";
import { jsonError } from "../../shared/errors";
import { RESPONSE_VERSION } from "../../shared/version";
import { LogsResponse } from "./schemas";

const parseTail = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

export const tail = Effect.fn("api.logs.tail")(function* (rawTail: string | undefined) {
  const paths = yield* RuntimePaths;
  const reader = yield* LogReader;

  return yield* reader.readTail({ logDir: paths.logDir, tail: parseTail(rawTail) }).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        jsonError({
          status: 500,
          code: "log_read_failed",
          message: error.message,
        }).pipe(Effect.orDie),
      onSuccess: (entries) =>
        Effect.succeed(
          LogsResponse.make({
            version: RESPONSE_VERSION,
            entries,
          }),
        ),
    }),
  );
});

export const logsHandlers = HttpApiBuilder.group(serverApi, "logs", (handlers) =>
  handlers.handle("tail", ({ query }) => tail(query.tail)),
);
