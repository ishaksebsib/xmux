import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { StatusResponse } from "../src/api/groups/status/schemas";
import { ServerOrchestratorStatusSnapshot } from "../src/orchestrator/status-model";

const decodeStatus = Schema.decodeUnknownSync(StatusResponse);
const decodeOrchestratorStatus = Schema.decodeUnknownSync(ServerOrchestratorStatusSnapshot);

const validStatusResponse = {
  version: 1,
  protocolVersion: 1,
  pid: process.pid,
  startedAt: "2026-06-16T00:00:00.000Z",
  uptimeMs: 10,
  state: "ready",
  configPath: "/tmp/xmux/config.jsonc",
  stateDir: "/tmp/xmux/state",
  scopeId: "status-model-test",
  endpoint: { kind: "unix-socket", path: "/tmp/xmux/server.sock" },
  orchestrator: {
    state: "degraded",
    activation: "enabled",
    chats: [{ id: "telegram", state: "failed", reason: "ChatAdapterOpenError" }],
    harnesses: [{ id: "opencode", state: "configured_lazy" }],
    reason: "OrchestratorStartupError",
  },
};

describe("status model", () => {
  it("rejects unsafe raw failure reasons", () => {
    assert.throws(() =>
      decodeStatus({
        ...validStatusResponse,
        orchestrator: {
          ...validStatusResponse.orchestrator,
          chats: [
            {
              id: "telegram",
              state: "failed",
              reason: "request failed with token secret-token-should-not-leak",
            },
          ],
        },
      }),
    );
  });

  it("rejects impossible adapter states", () => {
    assert.throws(() =>
      decodeOrchestratorStatus({
        state: "running",
        activation: "enabled",
        chats: [{ id: "telegram", state: "configured_lazy" }],
        harnesses: [{ id: "opencode", state: "active" }],
      }),
    );
  });

  it("keeps API schemas decoupled from the registry service", () => {
    const source = readFileSync("src/api/groups/status/schemas.ts", "utf8");
    assert.notInclude(source, "status-registry");
  });
});
