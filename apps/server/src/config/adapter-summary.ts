import { Effect } from "effect";
import type { ConfigPath } from "../contracts/primitives";
import { configuredFileChatIds, configuredFileHarnessIds } from "../orchestrator/adapter-registry";
import { loadServerConfigFile } from "./load-jsonc";

export type ConfiguredAdapterSummary =
  | {
      readonly status: "valid";
      readonly chats: readonly string[];
      readonly harnesses: readonly string[];
    }
  | {
      readonly status: "invalid";
    };

/**
 * Best-effort configured adapter summary for inactive CLI status. This parses
 * the raw JSONC file but intentionally does not resolve secrets or construct
 * runtime adapters. Missing config is valid empty defaults, matching normal
 * server config loading behavior.
 */
export const loadConfiguredAdapterSummary = Effect.fn("server.configuredAdapterSummary")(function* (
  configPath: ConfigPath,
) {
  return yield* loadServerConfigFile(configPath).pipe(
    Effect.match({
      onFailure: (): ConfiguredAdapterSummary => ({ status: "invalid" }),
      onSuccess: (config): ConfiguredAdapterSummary => ({
        status: "valid",
        chats: config === null ? [] : configuredFileChatIds(config),
        harnesses: config === null ? [] : configuredFileHarnessIds(config),
      }),
    }),
  );
});
