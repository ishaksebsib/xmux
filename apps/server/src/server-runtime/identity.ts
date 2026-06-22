import { Clock, Context, Effect, Layer } from "effect";
import {
  isoTimestampFromString,
  processIdFromNumber,
  sessionIdFromString,
  type IsoTimestamp,
  type ProcessId,
  type SessionId,
} from "../contracts/primitives";
import { HostRuntime } from "../platform/host";

/** Stable identity for one server process lifetime. */
export class ServerIdentity extends Context.Service<
  ServerIdentity,
  {
    readonly pid: ProcessId;
    readonly startedAt: Date;
    readonly startedAtIso: IsoTimestamp;
    readonly sessionId: SessionId;
  }
>()("@xmux/server/ServerIdentity") {
  /** Identity layer captures process metadata once at server startup. */
  static readonly layer = Layer.effect(
    ServerIdentity,
    Effect.gen(function* () {
      const startedAtMs = yield* Clock.currentTimeMillis;
      const host = yield* HostRuntime;
      const sessionId = sessionIdFromString(yield* host.randomUuid());
      const startedAt = new Date(startedAtMs);
      return {
        pid: processIdFromNumber(host.pid),
        startedAt,
        startedAtIso: isoTimestampFromString(startedAt.toISOString()),
        sessionId,
      };
    }),
  );
}
