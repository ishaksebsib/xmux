import { createXmuxClient, type XmuxClient } from "@xmux/server/platform/node";
import { Effect, Layer } from "effect";
import {
  ControlClient,
  type CliHealthResponse,
  type CliLogsResponse,
  type CliShutdownResponse,
  type CliStatusResponse,
} from "../../control/client";
import type { CliRunningServer } from "../../domain/discovery";
import { CliControlRequestError, CliServerUnreachable } from "../../domain/errors";
import type { CliControlOperation, CliTailCount } from "../../domain/input";

const unavailableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOENT",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const objectValue = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
};

const hasUnavailableTransportCause = (cause: unknown): boolean => {
  if (typeof cause === "object" && cause !== null) {
    const tag = objectValue(cause, "_tag");
    if (tag === "TransportError") return true;

    const reason = objectValue(cause, "reason");
    if (
      typeof reason === "object" &&
      reason !== null &&
      objectValue(reason, "_tag") === "TransportError"
    ) {
      return true;
    }

    const code = objectValue(cause, "code");
    if (typeof code === "string" && unavailableCodes.has(code)) return true;

    const nestedCause = objectValue(cause, "cause");
    if (nestedCause !== undefined && hasUnavailableTransportCause(nestedCause)) return true;

    if (reason !== undefined && hasUnavailableTransportCause(reason)) return true;
  }

  if (cause instanceof Error) {
    return /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOENT|ENOTFOUND|ETIMEDOUT|socket|timeout/i.test(
      cause.message,
    );
  }

  return false;
};

const mapClientCreateError =
  (
    server: CliRunningServer,
    operation: CliControlOperation,
  ): ((cause: unknown) => CliServerUnreachable) =>
  (cause) =>
    new CliServerUnreachable({
      message: "xmux server is unreachable.",
      socketPath: server.socketPath,
      operation,
      cause,
    });

const mapControlRequestError =
  (
    server: CliRunningServer,
    operation: CliControlOperation,
  ): ((cause: unknown) => CliServerUnreachable | CliControlRequestError) =>
  (cause) =>
    hasUnavailableTransportCause(cause)
      ? new CliServerUnreachable({
          message: "xmux server is unreachable.",
          socketPath: server.socketPath,
          operation,
          cause,
        })
      : new CliControlRequestError({
          message: `xmux ${operation} request failed.`,
          operation,
          socketPath: server.socketPath,
          cause,
        });

const withXmuxClient = <A>(input: {
  readonly server: CliRunningServer;
  readonly operation: CliControlOperation;
  readonly request: (client: XmuxClient) => Effect.Effect<A, unknown>;
}): Effect.Effect<A, CliServerUnreachable | CliControlRequestError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* createXmuxClient({ socketPath: input.server.socketPath }).pipe(
        Effect.mapError(mapClientCreateError(input.server, input.operation)),
      );
      return yield* input
        .request(client)
        .pipe(Effect.mapError(mapControlRequestError(input.server, input.operation)));
    }),
  );

export const nodeControlClientLayer = Layer.succeed(ControlClient, {
  health: Effect.fn("cli.client.health")(function* (server: CliRunningServer) {
    return yield* withXmuxClient<CliHealthResponse>({
      server,
      operation: "health",
      request: (client) => client.system.health(),
    });
  }),

  status: Effect.fn("cli.client.status")(function* (server: CliRunningServer) {
    return yield* withXmuxClient<CliStatusResponse>({
      server,
      operation: "status",
      request: (client) => client.status.status(),
    });
  }),

  logs: Effect.fn("cli.client.logs")(function* (
    server: CliRunningServer,
    tail: CliTailCount | undefined,
  ) {
    return yield* withXmuxClient<CliLogsResponse>({
      server,
      operation: "logs",
      request: (client) => client.logs.tail({ query: { tail } }),
    });
  }),

  shutdown: Effect.fn("cli.client.shutdown")(function* (server: CliRunningServer) {
    return yield* withXmuxClient<CliShutdownResponse>({
      server,
      operation: "shutdown",
      request: (client) => client.lifecycle.shutdown(),
    });
  }),
});
