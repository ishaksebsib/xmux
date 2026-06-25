import { NodeHttpClient, Undici } from "@effect/platform-node";
import { Duration, Effect, Exit, Schema, Scope } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { serverApi } from "../../../api/api";

const defaultXmuxClientBaseUrl = "http://xmux.local";
const CLIENT_GRACEFUL_CLOSE_TIMEOUT_MS = 1_000;

export interface CreateXmuxClientOptions {
  readonly socketPath: string;
  readonly baseUrl?: string | URL;
}

export type XmuxClient = HttpApiClient.ForApi<typeof serverApi>;

export class XmuxClientCreateError extends Schema.TaggedErrorClass<XmuxClientCreateError>()(
  "XmuxClientCreateError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const destroyDispatcher = (dispatcher: Undici.Dispatcher): Effect.Effect<void> =>
  Effect.promise(() => dispatcher.destroy()).pipe(Effect.ignore);

const releaseDispatcher = (
  dispatcher: Undici.Dispatcher,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> => {
  if (Exit.hasInterrupts(exit)) return destroyDispatcher(dispatcher);

  return Effect.timeoutOption(
    Effect.promise(() => dispatcher.close()),
    Duration.millis(CLIENT_GRACEFUL_CLOSE_TIMEOUT_MS),
  ).pipe(
    Effect.flatMap((closed) =>
      closed._tag === "Some" ? Effect.void : destroyDispatcher(dispatcher),
    ),
    Effect.catch(() => destroyDispatcher(dispatcher)),
  );
};

export const createXmuxClient: (
  options: CreateXmuxClientOptions,
) => Effect.Effect<XmuxClient, XmuxClientCreateError, Scope.Scope> = Effect.fn(
  "xmux.client.createXmuxClient",
)(function* (options) {
  if (options.socketPath.length === 0) {
    return yield* new XmuxClientCreateError({
      message: "xmux client socketPath must not be empty.",
    });
  }

  const baseUrl = options.baseUrl ?? defaultXmuxClientBaseUrl;
  const dispatcher = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new Undici.Client(baseUrl, { socketPath: options.socketPath }),
      catch: (cause) =>
        new XmuxClientCreateError({
          message: "Failed to create xmux Unix socket client.",
          cause,
        }),
    }),
    releaseDispatcher,
  );

  const httpClient = yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, dispatcher),
  );

  return yield* HttpApiClient.makeWith(serverApi, {
    baseUrl,
    httpClient,
  });
});
