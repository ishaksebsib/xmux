import { request as httpRequest } from "node:http";
import { Effect, Schema } from "effect";
import { createXmuxClient } from "../../src/platform/node";

export interface TestHttpResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Record<string, string | readonly string[] | undefined>;
}

export class UnixSocketRequestError extends Schema.TaggedErrorClass<UnixSocketRequestError>()(
  "UnixSocketRequestError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

/** Raw HTTP escape hatch for wire-level assertions that the typed API client intentionally hides. */
export const requestRawUnixHttp = (input: {
  readonly socketPath: string;
  readonly method: "GET" | "POST" | "DELETE" | "PATCH";
  readonly path: string;
  readonly body?: string;
  readonly timeoutMs?: number;
}): Effect.Effect<TestHttpResponse, UnixSocketRequestError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<TestHttpResponse>((resolve, reject) => {
        const request = httpRequest(
          { method: input.method, path: input.path, socketPath: input.socketPath },
          (response) => {
            const chunks: Array<string> = [];
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                statusCode: response.statusCode ?? 0,
                body: chunks.join(""),
                headers: response.headers,
              }),
            );
          },
        );
        request.setTimeout(input.timeoutMs ?? 2_000, () => {
          request.destroy(
            new Error(
              `Unix socket request timed out after ${input.timeoutMs ?? 2_000}ms: ${input.method} ${input.path}`,
            ),
          );
        });
        request.on("error", reject);
        if (input.body !== undefined) request.write(input.body);
        request.end();
      }),
    catch: (cause) => new UnixSocketRequestError({ message: "Unix socket request failed", cause }),
  });

export const getHealth = (socketPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.system.health();
    }),
  );

export const getStatus = (socketPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.status.status();
    }),
  );

export const getEffectiveConfig = (socketPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.config.effective();
    }),
  );

export const validateConfig = (socketPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.config.validate();
    }),
  );

export const tailLogs = (socketPath: string, tail = 20) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.logs.tail({ query: { tail } });
    }),
  );

export const requestShutdown = (socketPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath });
      return yield* client.lifecycle.shutdown();
    }),
  );
