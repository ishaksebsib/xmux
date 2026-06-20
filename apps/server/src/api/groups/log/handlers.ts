import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { API_VERSION } from "../../../contracts/constants";
import { LogReader } from "../../../logging/log-reader";
import { RuntimePaths } from "../../../runtime-state/runtime-paths-service";
import { serverApi } from "../../api";
import { jsonError } from "../../shared/errors";
import { LogsResponse } from "./schemas";

export const tail = Effect.fn("api.logs.tail")(function* (tail: number | undefined) {
  const paths = yield* RuntimePaths;
  const reader = yield* LogReader;

  return yield* reader.readTail({ logDir: paths.logDir, tail }).pipe(
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
            version: API_VERSION,
            entries,
          }),
        ),
    }),
  );
});

export const logsHandlers = HttpApiBuilder.group(serverApi, "logs", (handlers) =>
  handlers.handle("tail", ({ query }) => tail(query.tail)),
);
