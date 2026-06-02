import type { ChatTextInput } from "@xmux/chat-core";
import {
  formatCommandHelp,
  formatNoActiveSessionMessage,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import {
  PromptInteractionAlreadyRespondingError,
  PromptInteractionResponseError,
  PromptInteractionUnsupportedError,
} from "../prompt";
import type {
  RespondToCurrentInteractionError,
  RespondToCurrentInteractionOutput,
} from "./service";

export function formatInteractionOutput(output: RespondToCurrentInteractionOutput): ChatTextInput {
  switch (output.status) {
    case "responded":
      return formatResponded(output);
    case "not_active":
      return formatNoActiveSessionMessage({
        description: "There is no active session with a pending request.",
        nextStep: "continue.",
      });
    case "no_active_run":
      return markdown({
        text: [
          "**No active generation**",
          "",
          "There is no running generation with a pending request.",
        ].join("\n"),
      });
    case "no_pending_interaction":
      return markdown({
        text: [
          "**No pending request**",
          "",
          "There is no permission request waiting for `/allow` or `/reject`.",
        ].join("\n"),
      });
  }
}

export function formatInteractionFailure(error: RespondToCurrentInteractionError): ChatTextInput {
  if (PromptInteractionUnsupportedError.is(error)) {
    return markdown({
      text: [
        "**Cannot respond to current request**",
        "",
        error.kind === "question"
          ? `The current request is a question. Use ${inlineCode("/reject")} to dismiss it.`
          : markdownText(error.message),
      ].join("\n"),
    });
  }

  if (PromptInteractionAlreadyRespondingError.is(error)) {
    return markdown({
      text: [
        "**Request already being answered**",
        "",
        "Please wait for the harness response.",
      ].join("\n"),
    });
  }

  if (PromptInteractionResponseError.is(error)) {
    return markdown({
      text: ["**Failed to respond to permission request**", "", markdownText(error.message)].join(
        "\n",
      ),
    });
  }

  return markdown({
    text: ["**Failed to respond to request**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatAllowCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/allow",
    summary: "allow current permission request",
    description: "Allow the current harness permission request once or always.",
    usage: "/allow [always]",
    examples: ["/allow", "/allow always"],
  });
}

export function formatRejectCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/reject",
    summary: "reject current request",
    description: "Reject the current harness permission or question request.",
    usage: "/reject",
    examples: ["/reject"],
  });
}

function formatResponded(
  output: Extract<RespondToCurrentInteractionOutput, { readonly status: "responded" }>,
): ChatTextInput {
  const more =
    output.remainingPendingCount > 0
      ? "\n\nThere are more pending requests; use `/allow` or `/reject` again for the next one."
      : "";

  switch (output.action) {
    case "allowed_once":
      return markdown({
        text: `**Allowed**\n\nThe current permission request was allowed once.${more}`,
      });
    case "allowed_always":
      return markdown({
        text: `**Allowed always**\n\nFuture matching requests may be allowed automatically by the harness.${more}`,
      });
    case "rejected":
      return markdown({
        text: `**Rejected**\n\nThe current request was rejected.${more}`,
      });
  }
}
