import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import type { ExitActiveSessionError, ExitActiveSessionOutput } from "./service";

export function formatExitOutput(output: ExitActiveSessionOutput): ChatTextInput {
  return output.status === "exited" ? formatExitSuccess(output) : formatNoActiveSession();
}

export function formatExitFailure(error: ExitActiveSessionError): ChatTextInput {
  return markdown({
    text: ["**Failed to exit session**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatExitCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/exit",
    summary: "exit active session",
    description: "Detach this chat thread from its active session without deleting the session.",
    usage: "/exit",
    examples: ["/exit"],
  });
}

function formatExitSuccess(
  output: Extract<ExitActiveSessionOutput, { readonly status: "exited" }>,
): ChatTextInput {
  const lines = [
    "**Exited session**",
    "",
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Session ID: ${inlineCode(output.session.ref.sessionId)}`,
  ];

  if (output.session.title) {
    lines.push(`- Title: ${markdownText(output.session.title)}`);
  }

  if (output.session.cwd) {
    lines.push(`- Directory: ${inlineCode(output.session.cwd)}`);
  }

  lines.push("");
  lines.push("Create or resume a session to continue conversation.");

  return markdown({ text: lines.join("\n") });
}

function formatNoActiveSession(): ChatTextInput {
  return markdown({
    text: [
      "**No active session**",
      "",
      "You are not currently in a session.",
      "",
      `Use ${inlineCode("/new <harnessId>")} or ${inlineCode("/resume")} to continue conversation.`,
    ].join("\n"),
  });
}
