import {
  defineHarnessAdapter,
  type HarnessAdapterDefinition,
  type OpenedHarnessAdapter,
} from "@xmux/harness-core";
import { Result } from "better-result";
import {
  openRuntime,
  normalizeConfig,
  type OpenCodeAdapterConfig,
  type OpenCodeRuntime,
} from "./runtime";
import { createSession } from "./handlers/create-session";
import { getSession } from "./handlers/get-session";
import { listSessions } from "./handlers/list-sessions";
import { prompt } from "./handlers/prompt";
import { resumeSession } from "./handlers/resume-session";
import type { OpenCodeCreateOptions, OpenCodeSessionInfo } from "./handlers/utils";

export type OpenCodeAdapter = HarnessAdapterDefinition<
  "opencode",
  OpenCodeCreateOptions,
  OpenCodeSessionInfo
>;

async function createOpenedAdapter(
  runtime: OpenCodeRuntime,
): Promise<
  Result<OpenedHarnessAdapter<"opencode", OpenCodeCreateOptions, OpenCodeSessionInfo>, never>
> {
  return Result.ok({
    id: "opencode",
    createSession: async (input) => createSession(runtime, input),
    resumeSession: async (input) => resumeSession(runtime, input),
    listSessions: async (input) => listSessions(runtime, input),
    getSession: async (input) => getSession(runtime, input),
    prompt: async (input) => prompt(runtime, input),
    deleteSession: async () => Result.err(new Error("OpenCode deleteSession is not implemented")),
    abort: async () => Result.err(new Error("OpenCode abort is not implemented")),
    close: async () => {
      await runtime.close();
    },
  });
}

export function createOpenCodeAdapter(config?: OpenCodeAdapterConfig): OpenCodeAdapter {
  const normalizedConfig = normalizeConfig(config);

  return defineHarnessAdapter({
    id: "opencode",
    async open() {
      return Result.gen(async function* () {
        const runtime = yield* Result.await(openRuntime(normalizedConfig));
        const adapter = yield* Result.await(createOpenedAdapter(runtime));
        return Result.ok(adapter);
      });
    },
  });
}
