import type { Config, SttConfig } from "@xmux/orchestrator";
import { Redacted } from "effect";
import type { EffectiveServerConfig, EffectiveSttConfig } from "../config/effective";

const mapSttConfig = (stt: EffectiveSttConfig): SttConfig => {
  if (!stt.enabled) return { enabled: false };

  return {
    enabled: true,
    provider: stt.provider,
    ...(stt.apiKey === undefined ? {} : { apiKey: Redacted.value(stt.apiKey.value) }),
    ...(stt.baseUrl === undefined ? {} : { baseUrl: stt.baseUrl }),
    ...(stt.endpointPath === undefined ? {} : { endpointPath: stt.endpointPath }),
    model: stt.model,
    ...(stt.language === undefined ? {} : { language: stt.language }),
    maxBytes: stt.maxBytes,
    ...(stt.timeoutMs === undefined ? {} : { timeoutMs: stt.timeoutMs }),
  };
};

export const mapEffectiveConfigToXmuxConfig = (config: EffectiveServerConfig): Config => ({
  defaultWorkingDirectory: config.xmux.workspace.defaultDir,
  deliveryMode: "requester_only",
  workspace: {
    showHiddenFiles: config.xmux.commands.ls.showHidden,
    maxListEntries: config.xmux.commands.ls.maxEntries,
  },
  resume: {
    maxSessionsPerHarness: config.xmux.commands.resume.maxSessionsPerHarness,
  },
  model: {
    maxModelsPerProvider: config.xmux.commands.model.maxModelsPerProvider,
  },
  prompt: {
    response: {
      showToolOutput: !config.xmux.responses.tools.hide,
      showReasoning: !config.xmux.responses.thinking.hide,
      maxToolTextOutputChars: config.xmux.responses.tools.maxTextOutputChars,
      maxToolJsonOutputChars: config.xmux.responses.tools.maxJsonOutputChars,
      maxReasoningChars: config.xmux.responses.thinking.maxChars,
      maxToolInputStringChars: config.xmux.responses.tools.maxInputStringChars,
      maxToolInputObjectEntries: config.xmux.responses.tools.maxInputObjectEntries,
    },
    attachments: {
      enabled: config.xmux.attachments.enabled,
      maxBytes: config.xmux.attachments.maxBytes,
      kinds: config.xmux.attachments.kinds,
    },
  },
  ...(config.stt === undefined ? {} : { stt: mapSttConfig(config.stt) }),
});
