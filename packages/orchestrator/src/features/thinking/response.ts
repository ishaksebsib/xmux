import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import {
  HarnessAdapterThinkingUnsupportedError,
  type HarnessThinkingLevel,
} from "@xmux/harness-core";
import type { Actions } from "../../actions";
import { thinkingActionId } from "../../actions";
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
  ThinkingModelThinkingUnsupportedError,
  ThinkingModelUnsetError,
} from "./errors";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "../errors";
import { formatActionButtonRows } from "../button-layout";
import { normalizeTextInput, type ActionMessage } from "../utils";
import { formatModelSelector } from "../model/selector";
import type {
  ThinkingClearedOutput,
  ThinkingCommandError,
  ThinkingCommandOutput,
  ThinkingShownOutput,
  ThinkingUpdatedOutput,
} from "./service";
import { thinkingLevels } from "./selector";

export type ThinkingActionMessage = ActionMessage;

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

export function formatThinkingActionMessage(output: ThinkingCommandOutput): ThinkingActionMessage {
  const selection = output.status === "shown" ? output.current : output.selected;
  const message = normalizeTextInput(
    output.status === "shown" ? formatThinkingPickerShown(output) : formatThinkingOutput(output),
  );

  return {
    ...message,
    buttons: formatThinkingButtons({
      supportedLevels: selection.supportedLevels,
      current: selection.level,
    }),
  };
}

export function formatThinkingFailure(error: ThinkingCommandError): ChatTextInput {
  if (NoActiveSessionError.is(error)) {
    return formatNoActiveSessionMessage({
      description: "Create or resume a session before changing thinking level.",
      nextStep: "continue.",
    });
  }

  if (SessionClosedError.is(error)) {
    return markdown({
      text: [
        "**Session is closed**",
        "",
        `Start a new session with ${inlineCode("/new <harnessId>")}.`,
      ].join("\n"),
    });
  }

  if (SessionRecordMissingError.is(error)) {
    return markdown({
      text: ["**Failed to route thinking command**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (ThinkingModelUnsetError.is(error)) {
    return markdown({
      text: [
        "**Set a model first**",
        "",
        "Thinking levels depend on the active model.",
        "",
        `Use ${inlineCode("/model")} to choose a model, then run ${inlineCode("/thinking")} again.`,
      ].join("\n"),
    });
  }

  if (ThinkingModelThinkingUnsupportedError.is(error)) {
    return markdown({
      text: [
        "**Thinking not supported**",
        "",
        "The active model does not support configurable thinking levels.",
        "",
        ...(error.model === undefined
          ? []
          : [`- **Model:** ${inlineCode(formatModelSelector(error.model))}`]),
        `- **Next:** choose a reasoning-capable model with ${inlineCode("/model")}.`,
      ].join("\n"),
    });
  }

  if (ThinkingLevelInvalidError.is(error)) {
    return markdown({
      text: [
        "**Invalid thinking level**",
        "",
        `- **Requested level:** ${inlineCode(error.selector)}`,
        "",
        "**Use one of:**",
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
        `- **Requested level:** ${inlineCode(error.level)}`,
        "",
        "**Supported levels for this session:**",
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
  return markdown({
    text: [
      ...formatThinkingDetailsLines(output),
      "",
      ...formatSupportedLevels({
        supportedLevels: output.current.supportedLevels,
        current: output.current.level,
      }),
    ].join("\n"),
  });
}

function formatThinkingPickerShown(output: ThinkingShownOutput): ChatTextInput {
  return markdown({ text: formatThinkingDetailsLines(output).join("\n") });
}

function formatThinkingUpdated(output: ThinkingUpdatedOutput): ChatTextInput {
  return markdown({
    text: [
      "**Thinking level updated**",
      "",
      `- **Thinking Level:** ${formatCurrentLevel(output.selected.level)}`,
      `- **Source:** ${formatSource(output.selected.source)}`,
      `- **Harness:** ${inlineCode(output.session.ref.harnessId)}`,
      `- **Session ID:** ${inlineCode(output.session.ref.sessionId)}`,
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
      `- **Current Level:** ${formatCurrentLevel(output.selected.level)}`,
      `- **Source:** ${formatSource(output.selected.source)}`,
      `- **Harness:** ${inlineCode(output.session.ref.harnessId)}`,
      `- **Session ID:** ${inlineCode(output.session.ref.sessionId)}`,
    ].join("\n"),
  });
}

function formatThinkingDetailsLines(output: ThinkingShownOutput): readonly string[] {
  return [
    `**Thinking Level (${formatHeadingLevel(output.current.level)})**`,
    "",
    `- **Harness:** ${inlineCode(output.session.ref.harnessId)}`,
    `- **Session ID:** ${inlineCode(output.session.ref.sessionId)}`,
    `- **Current Level:** ${formatCurrentLevel(output.current.level)}`,
    `- **Source:** ${formatSource(output.current.source)}`,
  ];
}

function formatCurrentLevel(level: HarnessThinkingLevel | undefined): string {
  return level === undefined ? "**unset**" : `**${inlineCode(level)}**`;
}

function formatSource(source: string): string {
  return `**${markdownText(source)}**`;
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
      "**Try one of:**",
      `- ${inlineCode("/thinking low")}`,
      `- ${inlineCode("/thinking medium")}`,
      `- ${inlineCode("/thinking high")}`,
      `- ${inlineCode("/thinking xhigh")}`,
      `- ${inlineCode("/thinking max")}`,
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
      return `- ${level === input.current ? `**${inlineCode(level)}**` : inlineCode(level)}${currentMarker}`;
    }),
  ];
}

function formatLevelList(levels: readonly HarnessThinkingLevel[]): readonly string[] {
  const listed = levels.length === 0 ? thinkingLevels : levels;
  return listed.map((level) => `- ${inlineCode(level)}`);
}

function formatThinkingButtons(input: {
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly current?: HarnessThinkingLevel;
}): readonly (readonly ChatButtonInput<Actions>[])[] {
  const levels = input.supportedLevels ?? thinkingLevels;
  return formatActionButtonRows(
    levels.map((level) => formatThinkingButton({ level, current: input.current })),
  );
}

function formatThinkingButton(input: {
  readonly level: HarnessThinkingLevel;
  readonly current?: HarnessThinkingLevel;
}): ChatButtonInput<Actions> {
  switch (input.level) {
    case "off":
      return {
        ...thinkingButtonView("off", input.current),
        actionId: thinkingActionId,
        value: "off",
      };
    case "minimal":
      return {
        ...thinkingButtonView("minimal", input.current),
        actionId: thinkingActionId,
        value: "minimal",
      };
    case "low":
      return {
        ...thinkingButtonView("low", input.current),
        actionId: thinkingActionId,
        value: "low",
      };
    case "medium":
      return {
        ...thinkingButtonView("medium", input.current),
        actionId: thinkingActionId,
        value: "medium",
      };
    case "high":
      return {
        ...thinkingButtonView("high", input.current),
        actionId: thinkingActionId,
        value: "high",
      };
    case "xhigh":
      return {
        ...thinkingButtonView("xhigh", input.current),
        actionId: thinkingActionId,
        value: "xhigh",
      };
    case "max":
      return {
        ...thinkingButtonView("max", input.current),
        actionId: thinkingActionId,
        value: "max",
      };
  }
}

function thinkingButtonView(
  level: HarnessThinkingLevel,
  current: HarnessThinkingLevel | undefined,
): {
  readonly id: string;
  readonly label: string;
  readonly style: "primary" | "secondary";
} {
  return {
    id: `thinking-level-${level}`,
    label: `${level === current ? "✓ " : ""}${formatButtonLabel(level)}`,
    style: level === current ? "primary" : "secondary",
  };
}

function formatButtonLabel(level: HarnessThinkingLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatHeadingLevel(level: HarnessThinkingLevel | undefined): string {
  return level === undefined ? "Unset" : formatButtonLabel(level);
}
