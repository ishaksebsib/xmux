import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { UserIdUnavailableError } from "./errors";
import type { IdentifyUserError, IdentifyUserOutput } from "./service";

export function formatIdOutput(output: IdentifyUserOutput): ChatTextInput {
  const details = [
    `- **Chat:** ${inlineCode(output.chatId)}`,
    `- **User ID:** ${inlineCode(output.userId)}`,
    output.displayName === undefined
      ? undefined
      : `- **Name:** ${markdownText(output.displayName)}`,
  ].filter((line): line is string => line !== undefined);

  return markdown({
    text: ["**Your chat user id**", "", ...details].join("\n"),
  });
}

export function formatIdFailure(error: IdentifyUserError): ChatTextInput {
  if (UserIdUnavailableError.is(error)) {
    return markdown({
      text: [
        "**User id unavailable**",
        "",
        "This chat adapter did not provide a user id for this command.",
      ].join("\n"),
    });
  }

  return exhaustive(error);
}

function exhaustive(value: never): never {
  return value;
}

export function formatIdCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/id",
    summary: "show your chat user id",
    description: "Display the user id reported by the chat adapter for this command.",
    usage: "/id",
    examples: ["/id"],
  });
}
