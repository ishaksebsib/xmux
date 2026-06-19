import { randomUUID } from "node:crypto";
import { Clock, Context, Effect, Layer } from "effect";

/** Stable identity for one server process lifetime. */
export class ServerIdentity extends Context.Service<
  ServerIdentity,
  {
    readonly pid: number;
    readonly startedAt: Date;
    readonly sessionId: string;
  }
>()("@xmux/server/ServerIdentity") {}

/** Live identity captures process metadata once at server startup. */
export const ServerIdentityLive = Layer.effect(ServerIdentity)(
  Effect.gen(function* () {
    const startedAtMs = yield* Clock.currentTimeMillis;
    return {
      pid: process.pid,
      startedAt: new Date(startedAtMs),
      sessionId: randomUUID(),
    };
  }),
);
