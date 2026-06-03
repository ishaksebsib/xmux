import { defineHarnessAdapter, type OpenedHarnessAdapter } from "@xmux/harness-core";
import { Result } from "better-result";
import { openRuntime, normalizeConfig, type OpenCodeRuntime } from "./runtime";
import { abortSession } from "./handlers/abort";
import { createSession } from "./handlers/create-session";
import { deleteSession } from "./handlers/delete-session";
import { getSession } from "./handlers/get-session";
import { listSessions } from "./handlers/list-sessions";
import { getModel, listModels, setModel } from "./handlers/models";
import { prompt } from "./handlers/prompt";
import { getThinking, setThinking } from "./handlers/thinking";
import { resumeSession } from "./handlers/resume-session";
import { respondInteraction } from "./handlers/respond-interaction";
import type {
  OpenCodeAdapter,
  OpenCodeAdapterConfig,
  OpenCodeCreateOptions,
  OpenCodeModelInfo,
  OpenCodeSessionInfo,
} from "./types";

async function createOpenedAdapter(
  runtime: OpenCodeRuntime,
): Promise<
  Result<
    OpenedHarnessAdapter<"opencode", OpenCodeCreateOptions, OpenCodeSessionInfo, OpenCodeModelInfo>,
    never
  >
> {
  return Result.ok({
    id: "opencode",
    createSession: async (input) => createSession(runtime, input),
    resumeSession: async (input) => resumeSession(runtime, input),
    listSessions: async (input) => listSessions(runtime, input),
    getSession: async (input) => getSession(runtime, input),
    prompt: async (input) => prompt(runtime, input),
    listModels: async (input) => listModels(runtime, input),
    getModel: async (input) => getModel(runtime, input),
    setModel: async (input) => setModel(runtime, input),
    getThinking: async (input) => getThinking(runtime, input),
    setThinking: async (input) => setThinking(runtime, input),
    deleteSession: async (input) => deleteSession(runtime, input),
    abort: async (input) => abortSession(runtime, input),
    respondInteraction: async (input) => respondInteraction(runtime, input),
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
