import { Effect } from "effect";
import type { CliRunningServer } from "../domain/discovery";
import { serverStatusPayloadFromResponse } from "../domain/status";
import { ControlClient } from "./client";

export const runningOrchestratorStatus = Effect.fn("cli.control.runningOrchestratorStatus")(
  function* (server: CliRunningServer) {
    const client = yield* ControlClient;
    const status = yield* client.status(server);
    return serverStatusPayloadFromResponse(status).orchestrator;
  },
);
