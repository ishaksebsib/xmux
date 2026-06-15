import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown, markdownText } from "./markdown";

export interface CommandHelpInput {
  readonly command: string;
  readonly summary: string;
  readonly description: string;
  readonly usage: string;
  readonly examples: readonly string[];
}

export function formatCommandHelp(input: CommandHelpInput): ChatTextInput {
  return markdown({
    text: [
      `**${input.command} : ${markdownText(input.summary)}**`,
      "",
      markdownText(input.description),
      "",
      "**Usage**",
      "",
      inlineCode(input.usage),
      "",
      "**Examples**",
      ...input.examples.map((example) => `- ${inlineCode(example)}`),
    ].join("\n"),
  });
}
