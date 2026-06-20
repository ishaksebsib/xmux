import { Clock, Context, Effect, Layer } from "effect";
import { HostRuntime } from "./host";

/** Stable identity for one server process lifetime. */
export class ServerIdentity extends Context.Service<
  ServerIdentity,
  {
    readonly pid: number;
    readonly startedAt: Date;
    readonly sessionId: string;
  }
>()("@xmux/server/ServerIdentity") {}

/** Identity layer captures process metadata once at server startup. */
export const ServerIdentityLayer = Layer.effect(ServerIdentity)(
  Effect.gen(function* () {
    const startedAtMs = yield* Clock.currentTimeMillis;
    const host = yield* HostRuntime;
    const sessionId = yield* host.randomUuid;
    return {
      pid: host.pid,
      startedAt: new Date(startedAtMs),
      sessionId,
    };
  }),
);
