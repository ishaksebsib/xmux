import type { ChatButtonInput, ChatMessageFormat, ChatTextInput } from "@xmux/chat-core";
import { HarnessAdapterModelUnsupportedError, type HarnessModelInfo } from "@xmux/harness-core";
import type { Actions } from "../../actions";
import { modelActionId } from "../../actions";
import {
  formatCommandHelp,
  formatNoActiveSessionMessage,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import {
  ModelSelectorAmbiguousError,
  ModelSelectorInvalidError,
  ModelSelectorNotFoundError,
} from "./errors";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "../errors";
import type {
  ModelAvailableOutput,
  ModelCommandError,
  ModelCommandOutput,
  ModelShownOutput,
} from "./service";
import { formatModelSelector } from "./selector";

export interface ModelActionMessage {
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly buttons: readonly (readonly ChatButtonInput<Actions>[])[];
}

export interface ModelFailureFormatOptions {
  readonly maxSuggestions: number;
}

export function formatModelOutput(output: ModelCommandOutput): ChatTextInput {
  return output.status === "updated" ? formatModelUpdated(output) : formatModelShown(output);
}

export function formatModelActionMessage(output: ModelShownOutput): ModelActionMessage {
  return {
    ...normalizeTextInput(formatModelShown(output)),
    buttons: [[formatAvailableModelsButton()]],
  };
}

export function formatModelAvailableOutput(output: ModelAvailableOutput): ChatTextInput {
  return markdown({
    text: formatAvailableModels({
      models: output.models,
      current: output.current.model,
      maxModelsPerProvider: output.maxModelsPerProvider,
    }).join("\n"),
  });
}

export function formatModelFailure(
  error: ModelCommandError,
  options: ModelFailureFormatOptions,
): ChatTextInput {
  if (NoActiveSessionError.is(error)) {
    return formatNoActiveSessionMessage({
      description: "Create or resume a session before changing models.",
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
      text: ["**Failed to route model command**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (ModelSelectorInvalidError.is(error)) {
    return markdown({
      text: [
        "**Invalid model selector**",
        "",
        markdownText(error.message),
        "",
        `Use ${inlineCode("/model")} to list available models.`,
      ].join("\n"),
    });
  }

  if (ModelSelectorNotFoundError.is(error)) {
    return markdown({
      text: [
        "**Model not found**",
        "",
        `Selector: ${inlineCode(error.selector)}`,
        "",
        ...formatSelectorSuggestions({
          selectors: error.availableSelectors,
          maxSuggestions: options.maxSuggestions,
        }),
      ].join("\n"),
    });
  }

  if (ModelSelectorAmbiguousError.is(error)) {
    return markdown({
      text: [
        "**Model selector is ambiguous**",
        "",
        `Selector: ${inlineCode(error.selector)}`,
        "",
        "Matching models:",
        ...formatSelectorList({
          selectors: error.matchingSelectors,
          maxSuggestions: options.maxSuggestions,
        }),
      ].join("\n"),
    });
  }

  if (HarnessAdapterModelUnsupportedError.is(error)) {
    return markdown({
      text: [
        "**Model management unsupported**",
        "",
        `Harness ${inlineCode(error.harnessId)} does not support model management yet.`,
      ].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to manage model**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatModelCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/model",
    summary: "show or set the active session model",
    description: "Show available models for the active session, or set the session model.",
    usage: "/model [providerId/modelId]",
    examples: ["/model", "/model openai/gpt-4.1", "/model anthropic/claude-3-7-sonnet"],
  });
}

function formatModelShown(output: ModelShownOutput): ChatTextInput {
  const lines = [
    `**Model: ${formatCurrentModel(output.current.model)}**`,
    "",
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
    `- Current: ${formatCurrentModel(output.current.model)}`,
    `- Source: ${markdownText(output.current.source)}`,
  ];

  return markdown({ text: lines.join("\n") });
}

function formatAvailableModelsButton(): ChatButtonInput<Actions> {
  return {
    id: "model-available",
    label: "See available models",
    actionId: modelActionId,
    value: "available",
    style: "secondary",
  };
}

function formatModelUpdated(
  output: Extract<ModelCommandOutput, { readonly status: "updated" }>,
): ChatTextInput {
  const lines = [
    "**Model updated**",
    "",
    `- Current: ${formatCurrentModel(output.selected.model)}`,
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
    "",
    "This model is now selected for the current session.",
  ];

  return markdown({ text: lines.join("\n") });
}

function formatCurrentModel(model: ModelShownOutput["current"]["model"]): string {
  return model === undefined ? markdownText("unset") : inlineCode(formatModelSelector(model));
}

function formatAvailableModels(input: {
  readonly models: readonly HarnessModelInfo[];
  readonly current: ModelShownOutput["current"]["model"];
  readonly maxModelsPerProvider: number;
}): readonly string[] {
  if (input.models.length === 0) {
    return ["**Available models**", "", "No available models reported by this harness."];
  }

  const lines = [`**Available models** (${input.models.length})`, ""];

  for (const group of groupModelsByProvider(input.models)) {
    const displayedModels = group.models.slice(0, input.maxModelsPerProvider);
    lines.push(
      formatProviderHeader({
        providerName: group.providerName,
        shown: displayedModels.length,
        total: group.models.length,
      }),
    );
    lines.push("");

    for (const model of displayedModels) {
      lines.push(formatModelListItem({ model, current: input.current }));
      lines.push("");
    }

    const remaining = group.models.length - displayedModels.length;
    if (remaining > 0) {
      lines.push(`_And ${remaining} more models from ${markdownText(group.providerName)}._`);
      lines.push("");
    }
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function formatProviderHeader(input: {
  readonly providerName: string;
  readonly shown: number;
  readonly total: number;
}): string {
  const label = markdownText(input.providerName);
  return input.shown === input.total
    ? `> **${label}** (${input.total})`
    : `> **${label}** (showing ${input.shown} of ${input.total})`;
}

function formatModelListItem(input: {
  readonly model: HarnessModelInfo;
  readonly current: ModelShownOutput["current"]["model"];
}): string {
  const selector = formatModelSelector(input.model.ref);
  const currentMarker = isSameModel(input.model.ref, input.current) ? " — current" : "";

  return [
    `- ${formatModelDisplayName(input.model)}${currentMarker}`,
    `  - ${inlineCode(`/model ${selector}`)}`,
  ].join("\n");
}

function formatModelDisplayName(model: HarnessModelInfo): string {
  const displayName = model.name ?? formatModelSelector(model.ref);

  if (model.status === undefined || model.status === "active") {
    return markdownText(displayName);
  }

  return `${markdownText(displayName)} (${markdownText(model.status)})`;
}

function groupModelsByProvider(models: readonly HarnessModelInfo[]): readonly ModelProviderGroup[] {
  const groups: ModelProviderGroup[] = [];

  for (const model of models) {
    const providerName = model.providerName ?? formatProviderId(model.ref.providerId);
    const group = groups.find((candidate) => candidate.providerName === providerName);

    if (group) {
      group.models.push(model);
      continue;
    }

    groups.push({ providerName, models: [model] });
  }

  return groups;
}

function formatProviderId(providerId: string | undefined): string {
  if (providerId === undefined || providerId.length === 0) {
    return "Other";
  }

  const normalized = providerId.toLowerCase();
  switch (normalized) {
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "openai-compatible":
      return "OpenAI Compatible";
    default:
      return normalized
        .split(/[-_\s]+/)
        .filter((part) => part.length > 0)
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join(" ");
  }
}

interface ModelProviderGroup {
  readonly providerName: string;
  readonly models: HarnessModelInfo[];
}

function isSameModel(
  left: ModelShownOutput["current"]["model"],
  right: ModelShownOutput["current"]["model"],
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant
  );
}

function formatSelectorSuggestions(input: {
  readonly selectors: readonly string[];
  readonly maxSuggestions: number;
}): readonly string[] {
  if (input.selectors.length === 0) {
    return [`Use ${inlineCode("/model")} to list available models.`];
  }

  return ["Available models:", ...formatSelectorList(input)];
}

function formatSelectorList(input: {
  readonly selectors: readonly string[];
  readonly maxSuggestions: number;
}): readonly string[] {
  return [
    ...input.selectors
      .slice(0, input.maxSuggestions)
      .map((selector) => `- ${inlineCode(selector)}`),
    ...(input.selectors.length > input.maxSuggestions
      ? [`_And ${input.selectors.length - input.maxSuggestions} more models._`]
      : []),
  ];
}

function normalizeTextInput(input: ChatTextInput): {
  readonly text: string;
  readonly format?: ChatMessageFormat;
} {
  return typeof input === "string" ? { text: input } : input;
}
