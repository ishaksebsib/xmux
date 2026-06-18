import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { ServerOptions } from "../options";

/** Stable identity for one server process lifetime. */
export class ServerIdentity extends Context.Service<
  ServerIdentity,
  {
    readonly pid: number;
    readonly startedAt: Date;
    readonly sessionId: string;
  }
>()("@xmux/server/ServerIdentity") {}

/** Live identity preserves the server clock seam for deterministic lifecycle tests. */
export const ServerIdentityLive = Layer.effect(ServerIdentity)(
  Effect.gen(function* () {
    const options = yield* ServerOptions;
    return {
      pid: process.pid,
      startedAt: options.clock.now(),
      sessionId: randomUUID(),
    };
  }),
);
