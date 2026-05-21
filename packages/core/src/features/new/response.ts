import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import type { SessionRecord } from "../../store";
import { NewCommandHarnessNotConfiguredError } from "./errors";
import type { CreateSessionForThreadError } from "./service";

export function formatNewSessionSuccess(record: SessionRecord): ChatTextInput {
  const lines = [
    "**Session created**",
    "",
    `Harness: ${inlineCode(record.ref.harnessId)}`,
    `Session ID: ${inlineCode(record.ref.sessionId)}`,
  ];

  if (record.title) {
    lines.push(`Title: ${markdownText(record.title)}`);
  }

  const recommendedNextSteps = [
    "- The session is now active. Send a message to start the conversation.",
  ];

  for (const nextStep of recommendedNextSteps) {
    lines.push(nextStep);
    lines.push("");
  }

  return markdown({ text: lines.join("\n") });
}

export function formatNewSessionFailure(error: CreateSessionForThreadError): ChatTextInput {
  if (NewCommandHarnessNotConfiguredError.is(error)) {
    const available =
      error.availableHarnessIds.length > 0
        ? error.availableHarnessIds.map(inlineCode).join("\n - ")
        : "none";

    return markdown({
      text: [
        `**Error:** Unknown harness ${inlineCode(error.harnessId)}`,
        "",
        "Available harnesses",
        `- ${available}`,
      ].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to create session**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatNewCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/new",
    summary: "create a harness session",
    description: "Start a new coding-agent session in the current workspace directory.",
    usage: "/new <harnessId> [title]",
    examples: ["/new pi", "/new opencode my-session"],
  });
}
