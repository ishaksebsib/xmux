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
import { createSession, type OpenCodeCreateOptions, type OpenCodeSessionInfo } from "./session";

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
