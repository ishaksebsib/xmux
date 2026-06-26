import { createXmuxClient, type XmuxClient } from "@xmux/server/platform/node";
import { Context, Effect, Layer } from "effect";
import type { CliRunningServer } from "../domain/discovery";
import { CliControlRequestError, CliServerUnreachable } from "../domain/errors";
import type { CliControlOperation, CliTailCount } from "../domain/input";

export type CliHealthResponse = Effect.Success<ReturnType<XmuxClient["system"]["health"]>>;
export type CliStatusResponse = Effect.Success<ReturnType<XmuxClient["status"]["status"]>>;
export type CliLogsResponse = Effect.Success<ReturnType<XmuxClient["logs"]["tail"]>>;
export type CliShutdownResponse = Effect.Success<ReturnType<XmuxClient["lifecycle"]["shutdown"]>>;

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

export class ControlClient extends Context.Service<
  ControlClient,
  {
    readonly health: (
      server: CliRunningServer,
    ) => Effect.Effect<CliHealthResponse, CliServerUnreachable | CliControlRequestError>;
    readonly status: (
      server: CliRunningServer,
    ) => Effect.Effect<CliStatusResponse, CliServerUnreachable | CliControlRequestError>;
    readonly logs: (
      server: CliRunningServer,
      tail: CliTailCount | undefined,
    ) => Effect.Effect<CliLogsResponse, CliServerUnreachable | CliControlRequestError>;
    readonly shutdown: (
      server: CliRunningServer,
    ) => Effect.Effect<CliShutdownResponse, CliServerUnreachable | CliControlRequestError>;
  }
>()("@xmux/cli/ControlClient") {
  static readonly layer = Layer.succeed(ControlClient, {
    health: Effect.fn("cli.client.health")(function* (server: CliRunningServer) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* createXmuxClient({ socketPath: server.socketPath }).pipe(
            Effect.mapError(mapClientCreateError(server, "health")),
          );
          return yield* client.system
            .health()
            .pipe(Effect.mapError(mapControlRequestError(server, "health")));
        }),
      );
    }),

    status: Effect.fn("cli.client.status")(function* (server: CliRunningServer) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* createXmuxClient({ socketPath: server.socketPath }).pipe(
            Effect.mapError(mapClientCreateError(server, "status")),
          );
          return yield* client.status
            .status()
            .pipe(Effect.mapError(mapControlRequestError(server, "status")));
        }),
      );
    }),

    logs: Effect.fn("cli.client.logs")(function* (
      server: CliRunningServer,
      tail: CliTailCount | undefined,
    ) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* createXmuxClient({ socketPath: server.socketPath }).pipe(
            Effect.mapError(mapClientCreateError(server, "logs")),
          );
          return yield* client.logs
            .tail({ query: { tail } })
            .pipe(Effect.mapError(mapControlRequestError(server, "logs")));
        }),
      );
    }),

    shutdown: Effect.fn("cli.client.shutdown")(function* (server: CliRunningServer) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* createXmuxClient({ socketPath: server.socketPath }).pipe(
            Effect.mapError(mapClientCreateError(server, "shutdown")),
          );
          return yield* client.lifecycle
            .shutdown()
            .pipe(Effect.mapError(mapControlRequestError(server, "shutdown")));
        }),
      );
    }),
  });
}
