import { bulletList, inlineCode, markdownText } from "./markdown";

export type PromptToolStatus = "pending" | "running" | "completed" | "failed";

export interface PromptToolComponentInput {
  readonly name?: string;
  readonly callId: string;
  readonly input?: unknown;
  readonly rawInput?: string;
  readonly status: PromptToolStatus;
  readonly output?: readonly PromptToolOutputComponentInput[];
  readonly error?: unknown;
}

export type PromptToolOutputComponentInput =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "json"; readonly value: unknown }
  | { readonly type: "image"; readonly mimeType: string; readonly dataLength: number };

export interface PromptReasoningComponentInput {
  readonly text: string;
  readonly status: "streaming" | "done";
}

const visibleOutputTools = new Set([
  "bash",
  "shell",
  "grep",
  "find",
  "glob",
  "webfetch",
  "web_fetch",
  "websearch",
  "web_search",
]);

const hiddenOutputTools = new Set(["read", "write", "edit", "ls", "list"]);

/** Renders assistant reasoning as a quiet markdown quote. */
export function promptReasoning(input: PromptReasoningComponentInput): string {
  const text = input.text.replace("[REDACTED]", "").trim();
  if (text.length === 0) return "";

  const label = input.status === "streaming" ? "Reasoning…" : "Reasoning";
  return blockquote({ header: label, body: truncate(text, 3_000) });
}

/** Renders a tool call summary with optional compact output preview. */
export function promptTool(input: PromptToolComponentInput): string {
  const summary = `${toolStatusIcon(input.status)} ${toolDescription(input)}`;

  if (input.status === "failed") {
    return [summary, markdownText(describeUnknown(input.error ?? "Tool failed"))].join("\n");
  }

  if (input.status !== "completed" || !shouldShowToolOutput(input)) {
    return summary;
  }

  const output = promptToolOutput(input.output ?? []);
  return output.length === 0 ? summary : `${summary}\n\n${output}`;
}

export function promptRetry(input: {
  readonly attempt: number;
  readonly maxAttempts?: number;
  readonly error?: unknown;
}): string {
  const max = input.maxAttempts === undefined ? "" : `/${input.maxAttempts}`;
  const error = input.error === undefined ? "" : ` — ${describeUnknown(input.error)}`;
  return `↻ Retrying ${input.attempt}${max}${markdownText(error)}`;
}

export interface PromptInteractionComponentInput {
  readonly kind: "permission" | "question";
  readonly phase: "requested" | "answered" | "rejected";
  readonly prompt?: string;
  readonly title?: string;
  readonly permission?: {
    readonly name?: string;
    readonly patterns?: readonly string[];
    readonly allowAlways?: boolean;
  };
  readonly question?: {
    readonly questions: readonly {
      readonly header?: string;
      readonly question: string;
      readonly options?: readonly {
        readonly label: string;
        readonly description?: string;
      }[];
      readonly multiple?: boolean;
      readonly custom?: boolean;
    }[];
  };
}

export function promptInteraction(input: PromptInteractionComponentInput): string {
  if (input.phase !== "requested") {
    return formatResolvedInteraction(input);
  }

  return input.kind === "permission"
    ? formatPermissionRequest(input)
    : formatQuestionRequest(input);
}

function formatResolvedInteraction(input: PromptInteractionComponentInput): string {
  if (input.kind === "permission") {
    return input.phase === "answered" ? "✓ Permission allowed" : "✗ Permission rejected";
  }

  return input.phase === "answered" ? "✓ Question answered" : "✗ Question rejected";
}

function formatPermissionRequest(input: PromptInteractionComponentInput): string {
  const details = permissionDetails(input);
  const parts = [
    "⚠️ **Permission requested**",
    details.request ? section("Request", details.request) : undefined,
    details.scope.length > 0 ? section("Scope", bulletList(details.scope)) : undefined,
    section(
      "Respond",
      bulletList([
        `${inlineCode("/allow")} — allow this request once`,
        `${inlineCode("/allow always")} — always allow matching future requests`,
        `${inlineCode("/reject")} — reject this request`,
      ]),
    ),
  ];

  return compactLines(parts);
}

function formatQuestionRequest(input: PromptInteractionComponentInput): string {
  const questions = input.question?.questions ?? [];
  const body =
    questions.length > 0
      ? questions.map((question, index) => formatQuestion(question, index)).join("\n\n")
      : markdownText(input.prompt?.trim() || "The harness is waiting for an answer.");

  return compactLines([
    "⚠️ **Question requested**",
    section(questions.length > 1 ? "Questions" : "Question", body),
    section("Respond", bulletList([`${inlineCode("/reject")} — dismiss this question`])),
  ]);
}

function permissionDetails(input: PromptInteractionComponentInput): {
  readonly request?: string;
  readonly scope: readonly string[];
} {
  const fallback = parsePermissionPrompt(input.prompt);
  const request = input.permission?.name ?? input.title ?? fallback.request;
  const patterns = input.permission?.patterns ?? fallback.scope;

  return {
    request: request ? inlineCode(request) : undefined,
    scope: patterns.map((pattern) => inlineCode(pattern)),
  };
}

function parsePermissionPrompt(prompt: string | undefined): {
  readonly request?: string;
  readonly scope: readonly string[];
} {
  const trimmed = prompt?.trim();
  if (!trimmed) return { scope: [] };

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { scope: [] };

  const first = lines[0];
  if (!first) return { scope: [] };

  const rest = lines.slice(1);
  const colon = first.indexOf(":");
  if (colon > 0) {
    const request = first.slice(0, colon).trim();
    const firstScope = first
      .slice(colon + 1)
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return { request, scope: [...firstScope, ...rest] };
  }

  return { request: first, scope: rest };
}

function formatQuestion(
  question: NonNullable<PromptInteractionComponentInput["question"]>["questions"][number],
  index: number,
): string {
  const title = question.header
    ? `**${index + 1}. ${markdownText(question.header)}**`
    : `**${index + 1}.**`;
  const options = question.options ?? [];
  const optionLines =
    options.length === 0
      ? []
      : [
          "",
          "Options:",
          bulletList(
            options.map((option) =>
              option.description
                ? `${inlineCode(option.label)} — ${markdownText(option.description)}`
                : inlineCode(option.label),
            ),
          ),
        ];

  return compactLines([title, markdownText(question.question), ...optionLines]);
}

function section(title: string, body: string): string {
  return `**${title}**\n${body}`;
}

function compactLines(lines: readonly (string | undefined)[]): string {
  return lines.filter((line): line is string => line !== undefined && line.length > 0).join("\n\n");
}

export function promptUsage(input: {
  readonly model?: string;
  readonly harnessId?: string;
  readonly thinking?: string;
  readonly tokens?: {
    readonly total?: number;
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly cost?: number;
}): string {
  const details = [
    input.model === undefined ? undefined : `Model: ${inlineCode(input.model)}`,
    input.harnessId === undefined ? undefined : `Harness: ${inlineCode(input.harnessId)}`,
    input.thinking === undefined ? undefined : `Thinking: ${inlineCode(input.thinking)}`,
    formatTokenLine(input.tokens),
    formatContextLine(input.tokens),
    formatCostLine(input.cost),
  ].filter((part): part is string => part !== undefined && part.length > 0);

  if (details.length === 0) return "";

  return ["**Stats**", ...details.map((detail) => `_${detail}_`)].join("\n");
}

function formatTokenLine(
  tokens:
    | {
        readonly total?: number;
        readonly input?: number;
        readonly output?: number;
        readonly reasoning?: number;
        readonly cacheRead?: number;
        readonly cacheWrite?: number;
      }
    | undefined,
): string | undefined {
  if (!tokens) return undefined;

  const total =
    tokens.total ??
    sumDefined(tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite);

  return total === undefined ? undefined : `Tokens: ${formatNumber(total)}`;
}

function formatContextLine(
  tokens:
    | {
        readonly input?: number;
        readonly cacheRead?: number;
        readonly cacheWrite?: number;
      }
    | undefined,
): string | undefined {
  if (!tokens) return undefined;

  const context = sumDefined(tokens.input, tokens.cacheRead, tokens.cacheWrite);
  return context === undefined ? undefined : `Context: ${formatNumber(context)} used`;
}

function formatCostLine(cost: number | undefined): string | undefined {
  if (cost === undefined || cost <= 0) return undefined;
  return `Cost: $${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function sumDefined(...values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  let found = false;

  for (const value of values) {
    if (value === undefined) continue;
    total += value;
    found = true;
  }

  return found ? total : undefined;
}

function toolStatusIcon(status: PromptToolStatus): string {
  switch (status) {
    case "pending":
      return "…";
    case "running":
      return "↻";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
  }
}

function toolDescription(input: PromptToolComponentInput): string {
  const name = input.name ?? "tool";
  const normalized = name.toLowerCase();
  const record = toRecord(input.input);
  const raw =
    typeof input.rawInput === "string" && input.rawInput.trim().length > 0
      ? input.rawInput.trim()
      : undefined;

  if (normalized === "read") {
    return `Read ${inlineCode(stringField(record, "filePath", "path") ?? "file")}`;
  }

  if (normalized === "write") {
    return `Write ${inlineCode(stringField(record, "filePath", "path") ?? "file")}`;
  }

  if (normalized === "edit") {
    return `Edit ${inlineCode(stringField(record, "filePath", "path") ?? "file")}`;
  }

  if (normalized === "ls" || normalized === "list") {
    return `List ${inlineCode(stringField(record, "path", "directory") ?? ".")}`;
  }

  if (normalized === "bash" || normalized === "shell") {
    return `$ ${markdownText(stringField(record, "command", "cmd") ?? raw ?? "command")}`;
  }

  if (normalized === "grep") {
    const pattern = stringField(record, "pattern", "query") ?? "pattern";
    const path = stringField(record, "path", "directory");
    return path
      ? `Grep ${inlineCode(pattern)} in ${inlineCode(path)}`
      : `Grep ${inlineCode(pattern)}`;
  }

  if (normalized === "find" || normalized === "glob") {
    const pattern = stringField(record, "pattern", "query") ?? "pattern";
    const path = stringField(record, "path", "directory");
    return path
      ? `${titleCase(normalized)} ${inlineCode(pattern)} in ${inlineCode(path)}`
      : `${titleCase(normalized)} ${inlineCode(pattern)}`;
  }

  if (normalized === "webfetch" || normalized === "web_fetch") {
    return `Web fetch ${inlineCode(stringField(record, "url") ?? "url")}`;
  }

  if (normalized === "websearch" || normalized === "web_search") {
    return `Web search ${inlineCode(stringField(record, "query") ?? "query")}`;
  }

  const inputSummary = record ? compactObject(record) : raw;

  return inputSummary ? `${inlineCode(name)} ${markdownText(inputSummary)}` : inlineCode(name);
}

function shouldShowToolOutput(input: PromptToolComponentInput): boolean {
  const normalized = input.name?.toLowerCase();
  if (!normalized) return true;
  if (hiddenOutputTools.has(normalized)) return false;
  return visibleOutputTools.has(normalized) || !hiddenOutputTools.has(normalized);
}

function promptToolOutput(outputs: readonly PromptToolOutputComponentInput[]): string {
  const rendered = outputs.map((output) => {
    switch (output.type) {
      case "text":
        return fenced("text", truncate(output.text.trim(), 2_000));
      case "json":
        return fenced("json", truncate(stringifyUnknown(output.value), 2_000));
      case "image":
        return `_Image output: ${markdownText(output.mimeType)}, ${formatNumber(output.dataLength)} bytes._`;
    }
  });

  return rendered.filter((value) => value.length > 0).join("\n\n");
}

function fenced(language: string, value: string): string {
  if (value.length === 0) return "";
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function blockquote(input: { readonly header: string; readonly body: string }): string {
  return [
    `> **${input.header}**`,
    ">",
    ...input.body.split("\n").map((line) => `> ${markdownText(line)}`),
  ].join("\n");
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  ...keys: readonly string[]
): string | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

function compactObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value).slice(0, 3);
  if (entries.length === 0) return "";

  const suffix = Object.keys(value).length > entries.length ? ", …" : "";
  return `{ ${entries.map(([key, item]) => `${key}: ${compactValue(item)}`).join(", ")}${suffix} }`;
}

function compactValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(truncate(value, 80));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeUnknown(value: unknown): string {
  return value instanceof Error ? value.message : stringifyUnknown(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n… truncated ${formatNumber(value.length - maxLength)} chars`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
