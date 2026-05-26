import type { ChatTextInput } from "@xmux/chat-core";
import {
  HarnessAdapterThinkingUnsupportedError,
  type HarnessThinkingLevel,
} from "@xmux/harness-core";
import {
  formatCommandHelp,
  formatNoActiveSessionMessage,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import {
  ThinkingLevelInvalidError,
  ThinkingLevelUnsupportedError,
  ThinkingNoActiveSessionError,
  ThinkingSessionClosedError,
  ThinkingSessionRecordMissingError,
} from "./errors";
import type {
  ThinkingClearedOutput,
  ThinkingCommandError,
  ThinkingCommandOutput,
  ThinkingShownOutput,
  ThinkingUpdatedOutput,
} from "./service";
import { thinkingLevels } from "./selector";

export function formatThinkingOutput(output: ThinkingCommandOutput): ChatTextInput {
  switch (output.status) {
    case "shown":
      return formatThinkingShown(output);
    case "updated":
      return formatThinkingUpdated(output);
    case "cleared":
      return formatThinkingCleared(output);
  }
}

export function formatThinkingFailure(error: ThinkingCommandError): ChatTextInput {
  if (ThinkingNoActiveSessionError.is(error)) {
    return formatNoActiveSessionMessage({
      description: "Create or resume a session before changing thinking level.",
      nextStep: "continue.",
    });
  }

  if (ThinkingSessionClosedError.is(error)) {
    return markdown({
      text: [
        "**Session is closed**",
        "",
        `Start a new session with ${inlineCode("/new <harnessId>")}.`,
      ].join("\n"),
    });
  }

  if (ThinkingSessionRecordMissingError.is(error)) {
    return markdown({
      text: ["**Failed to route thinking command**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (ThinkingLevelInvalidError.is(error)) {
    return markdown({
      text: [
        "**Invalid thinking level**",
        "",
        `Level: ${inlineCode(error.selector)}`,
        "",
        "Use one of:",
        ...formatLevelList(error.availableLevels),
        `- ${inlineCode("clear")}`,
      ].join("\n"),
    });
  }

  if (ThinkingLevelUnsupportedError.is(error)) {
    return markdown({
      text: [
        "**Thinking level unsupported**",
        "",
        `Level: ${inlineCode(error.level)}`,
        "",
        "Supported levels for this session:",
        ...formatLevelList(error.supportedLevels),
      ].join("\n"),
    });
  }

  if (HarnessAdapterThinkingUnsupportedError.is(error)) {
    return markdown({
      text: [
        "**Thinking management unsupported**",
        "",
        `Harness ${inlineCode(error.harnessId)} does not support thinking management yet.`,
      ].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to manage thinking level**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatThinkingCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/thinking",
    summary: "show or set the active session thinking level",
    description: "Show the active session thinking level, set it, or clear the session override.",
    usage: "/thinking [level|clear]",
    examples: [
      "/thinking",
      "/thinking low",
      "/thinking high",
      "/thinking xhigh",
      "/thinking clear",
    ],
  });
}

function formatThinkingShown(output: ThinkingShownOutput): ChatTextInput {
  const lines = [
    "**Thinking**",
    "",
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
    `- Current: ${formatCurrentLevel(output.current.level)}`,
    `- Source: ${markdownText(output.current.source)}`,
    "",
    ...formatSupportedLevels({
      supportedLevels: output.current.supportedLevels,
      current: output.current.level,
    }),
  ];

  return markdown({ text: lines.join("\n") });
}

function formatThinkingUpdated(output: ThinkingUpdatedOutput): ChatTextInput {
  return markdown({
    text: [
      "**Thinking updated**",
      "",
      `- Current: ${formatCurrentLevel(output.selected.level)}`,
      `- Source: ${markdownText(output.selected.source)}`,
      `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
      `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
      "",
      "This thinking level is now selected for the current session.",
    ].join("\n"),
  });
}

function formatThinkingCleared(output: ThinkingClearedOutput): ChatTextInput {
  return markdown({
    text: [
      "**Thinking override cleared**",
      "",
      `- Current: ${formatCurrentLevel(output.selected.level)}`,
      `- Source: ${markdownText(output.selected.source)}`,
      `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
      `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
    ].join("\n"),
  });
}

function formatCurrentLevel(level: HarnessThinkingLevel | undefined): string {
  return level === undefined ? markdownText("unset") : inlineCode(level);
}

function formatSupportedLevels(input: {
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly current?: HarnessThinkingLevel;
}): readonly string[] {
  if (input.supportedLevels === undefined) {
    return [
      "**Supported levels**",
      "",
      "Supported levels were not reported by this harness.",
      "",
      `Try ${inlineCode("/thinking low")}, ${inlineCode("/thinking medium")}, ${inlineCode(
        "/thinking high",
      )}, ${inlineCode("/thinking xhigh")}, or ${inlineCode("/thinking max")}.`,
    ];
  }

  if (input.supportedLevels.length === 0) {
    return [
      "**Supported levels**",
      "",
      "No supported thinking levels were reported by this harness.",
    ];
  }

  return [
    `**Supported levels** (${input.supportedLevels.length})`,
    "",
    ...input.supportedLevels.map((level) => {
      const currentMarker = level === input.current ? " — current" : "";
      return `- ${inlineCode(level)}${currentMarker}`;
    }),
  ];
}

function formatLevelList(levels: readonly HarnessThinkingLevel[]): readonly string[] {
  const listed = levels.length === 0 ? thinkingLevels : levels;
  return listed.map((level) => `- ${inlineCode(level)}`);
}
