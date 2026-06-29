import type { EffectiveServerConfig } from "../config/effective";
import {
  configuredEffectiveChatIds,
  configuredEffectiveHarnessIds,
  type ServerChatId,
  type ServerHarnessId,
} from "./adapter-registry";

export type { ServerChatId, ServerHarnessId } from "./adapter-registry";

export type OrchestratorActivation =
  | {
      readonly _tag: "Disabled";
      readonly reason: "NoChatsConfigured";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
    }
  | {
      readonly _tag: "Invalid";
      readonly reason: "ChatsWithoutHarnesses";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
      readonly message: string;
    }
  | {
      readonly _tag: "Enabled";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
      readonly config: EffectiveServerConfig;
    };

export const configuredChatIds = (config: EffectiveServerConfig): ReadonlyArray<ServerChatId> =>
  configuredEffectiveChatIds(config);

export const configuredHarnessIds = (
  config: EffectiveServerConfig,
): ReadonlyArray<ServerHarnessId> => configuredEffectiveHarnessIds(config);

export const decideOrchestratorActivation = (
  config: EffectiveServerConfig,
): OrchestratorActivation => {
  const chats = configuredChatIds(config);
  const harnesses = configuredHarnessIds(config);

  if (chats.length === 0) {
    return { _tag: "Disabled", reason: "NoChatsConfigured", chats, harnesses };
  }

  if (harnesses.length === 0) {
    return {
      _tag: "Invalid",
      reason: "ChatsWithoutHarnesses",
      chats,
      harnesses,
      message: "At least one harness must be configured when chat adapters are enabled.",
    };
  }

  return { _tag: "Enabled", chats, harnesses, config };
};
