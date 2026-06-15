import type { ChatTextContent } from "@xmux/chat-core";

export type MarkdownResponse = ChatTextContent & { readonly format: "markdown" };

export function markdown(input: { readonly text: string }): MarkdownResponse {
  return { text: input.text, format: "markdown" };
}

export function inlineCode(value: string): string {
  const maxBacktickRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(maxBacktickRun + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";

  return `${fence}${padding}${value}${padding}${fence}`;
}

export function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
}

export function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
