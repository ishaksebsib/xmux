import type { ChatButtonInput, ChatMessageFormat, ChatTextInput } from "@xmux/chat-core";
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

export interface ThinkingActionMessage {
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly buttons: readonly (readonly ChatButtonInput<Actions>[])[];
}

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
  const message = normalizeTextInput(formatThinkingActionText(output));
  const selection = output.status === "shown" ? output.current : output.selected;

  return {
    ...message,
    buttons: formatThinkingButtons({
      supportedLevels: selection.supportedLevels,
      current: selection.level,
    }),
  };
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
          : [`- **Model:** ${inlineCode(formatModelRef(error.model))}`]),
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

function formatThinkingActionText(output: ThinkingCommandOutput): ChatTextInput {
  return output.status === "shown"
    ? formatThinkingActionShown(output)
    : formatThinkingOutput(output);
}

function formatThinkingShown(output: ThinkingShownOutput): ChatTextInput {
  const lines = [
    "**Thinking Level**",
    "",
    `- **Harness:** ${inlineCode(output.session.ref.harnessId)}`,
    `- **Session ID:** ${inlineCode(output.session.ref.sessionId)}`,
    `- **Current Level:** ${formatCurrentLevel(output.current.level)}`,
    `- **Source:** ${formatSource(output.current.source)}`,
    "",
    ...formatSupportedLevels({
      supportedLevels: output.current.supportedLevels,
      current: output.current.level,
    }),
  ];

  return markdown({ text: lines.join("\n") });
}

function formatThinkingActionShown(output: ThinkingShownOutput): ChatTextInput {
  return markdown({
    text: [
      "**Thinking Level**",
      "",
      `- **Harness:** ${inlineCode(output.session.ref.harnessId)}`,
      `- **Session ID:** ${inlineCode(output.session.ref.sessionId)}`,
      `- **Current Level:** ${formatCurrentLevel(output.current.level)}`,
      `- **Source:** ${formatSource(output.current.source)}`,
    ].join("\n"),
  });
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
  const buttons = levels.map((level) => formatThinkingButton({ level, current: input.current }));
  return chunkButtons(buttons, 3);
}

function formatThinkingButton(input: {
  readonly level: HarnessThinkingLevel;
  readonly current?: HarnessThinkingLevel;
}): ChatButtonInput<Actions> {
  return {
    id: `thinking-level-${input.level}`,
    label: `${input.level === input.current ? "✓ " : ""}${formatButtonLabel(input.level)}`,
    actionId: thinkingActionId,
    value: input.level,
    style: input.level === input.current ? "primary" : "secondary",
  } as ChatButtonInput<Actions>;
}

function chunkButtons(
  buttons: readonly ChatButtonInput<Actions>[],
  size: number,
): readonly (readonly ChatButtonInput<Actions>[])[] {
  const rows: ChatButtonInput<Actions>[][] = [];

  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }

  return rows;
}

function formatButtonLabel(level: HarnessThinkingLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function normalizeTextInput(input: ChatTextInput): {
  readonly text: string;
  readonly format?: ChatMessageFormat;
} {
  return typeof input === "string" ? { text: input } : input;
}

function formatModelRef(ref: {
  readonly providerId?: string;
  readonly modelId: string;
  readonly variant?: string;
}): string {
  const base = ref.providerId === undefined ? ref.modelId : `${ref.providerId}/${ref.modelId}`;
  return ref.variant === undefined ? base : `${base}@${ref.variant}`;
}
