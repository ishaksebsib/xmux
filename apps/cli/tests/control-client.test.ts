import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ControlClient } from "../src/control/client";
import { parseTailCount } from "../src/domain/input";
import { nodeControlClientLayer } from "../src/platform/node/control-client";
import { runningServer } from "./support/client";

describe("ControlClient", () => {
  it.live("maps request-time socket failures to CliServerUnreachable", () =>
    Effect.gen(function* () {
      const missingSocket = join(tmpdir(), `xmux-missing-${process.pid}-${Date.now()}.sock`);
      const client = yield* ControlClient;
      const error = yield* Effect.flip(client.status(runningServer(missingSocket)));

      expect(error._tag).toBe("CliServerUnreachable");
      if (error._tag === "CliServerUnreachable") {
        expect(error.operation).toBe("status");
        expect(error.socketPath).toBe(missingSocket);
      }
    }).pipe(Effect.provide(nodeControlClientLayer)),
  );

  it.effect("does not reach the logs API when tail parsing fails", () =>
    Effect.gen(function* () {
      let reachedClientApi = false;
      const program = Effect.gen(function* () {
        const tail = yield* parseTailCount(0);
        reachedClientApi = true;
        const client = yield* ControlClient;
        return yield* client.logs(runningServer("/tmp/unreachable.sock"), tail);
      }).pipe(Effect.provide(nodeControlClientLayer));

      yield* Effect.flip(program);
      expect(reachedClientApi).toBe(false);
    }),
  );
});
