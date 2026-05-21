import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown } from "../../components";

export interface FormatUnknownCommandResponseInput {
  readonly commandName: string;
  readonly availableCommands: readonly string[];
}

export function formatUnknownCommandResponse(
  input: FormatUnknownCommandResponseInput,
): ChatTextInput {
  return markdown({
    text: [
      `**Error:** Unknown command ${inlineCode(formatCommandName(input.commandName))}`,
      "",
      "Available commands",
      formatAvailableCommands(input.availableCommands),
    ].join("\n"),
  });
}

function formatAvailableCommands(commands: readonly string[]): string {
  return commands.length > 0
    ? commands.map((command) => `- ${inlineCode(command)}`).join("\n")
    : "- none";
}

function formatCommandName(commandName: string): string {
  return commandName.startsWith("/") ? commandName : `/${commandName}`;
}
