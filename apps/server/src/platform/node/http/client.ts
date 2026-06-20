import { NodeHttpClient, Undici } from "@effect/platform-node";
import { Effect, Schema, Scope } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { serverApi } from "../../../api/api";

const defaultXmuxClientBaseUrl = "http://xmux.local";

export interface CreateXmuxClientOptions {
  readonly socketPath: string;
  readonly baseUrl?: string | URL;
}

export type XmuxClient = HttpApiClient.ForApi<typeof serverApi>;

export class XmuxClientCreateError extends Schema.TaggedErrorClass<XmuxClientCreateError>()(
  "XmuxClientCreateError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

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
    (dispatcher) => Effect.promise(() => dispatcher.close()).pipe(Effect.ignore),
  );

  const httpClient = yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, dispatcher),
  );

  return yield* HttpApiClient.makeWith(serverApi, {
    baseUrl,
    httpClient,
  });
});
