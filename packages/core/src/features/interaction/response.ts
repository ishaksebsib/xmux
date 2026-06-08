import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import type { Actions } from "../../actions";
import { interactionActionId } from "../../actions";
import {
  formatCommandHelp,
  formatNoActiveSessionMessage,
  inlineCode,
  markdown,
  markdownText,
  promptInteraction,
  type PromptInteractionComponentInput,
} from "../../components";
import {
  PromptInteractionAlreadyRespondingError,
  PromptInteractionResponseError,
  PromptInteractionUnsupportedError,
} from "../prompt";
import type { ActionMessage } from "../utils";
import type {
  RespondToCurrentInteractionError,
  RespondToCurrentInteractionOutput,
} from "./service";

/** The harness request fields needed to render an interaction prompt with buttons. */
export type InteractionRequestView = Omit<PromptInteractionComponentInput, "phase" | "respond">;

export type InteractionResolvedAction = Extract<
  RespondToCurrentInteractionOutput,
  { readonly status: "responded" }
>["action"];

/** Renders a pending interaction as a button message replacing the slash-command hints. */
export function formatInteractionActionMessage(input: {
  readonly ordinal: number;
  readonly request: InteractionRequestView;
}): ActionMessage {
  return {
    text: promptInteraction({ ...input.request, phase: "requested", respond: "none" }),
    format: "markdown",
    buttons: formatInteractionButtons({
      kind: input.request.kind,
      ordinal: input.ordinal,
      allowAlways: input.request.permission?.allowAlways ?? false,
    }),
  };
}

/** Marks a resolved interaction message and clears its buttons. */
export function formatInteractionResolvedMessage(input: {
  readonly kind: "permission" | "question";
  readonly action: InteractionResolvedAction;
}): ActionMessage {
  return { text: formatResolvedText(input), format: "markdown", buttons: [] };
}

/** Replaces a stale interaction message whose request is no longer pending. */
export function formatInteractionStaleMessage(): ActionMessage {
  return { text: "_This request is no longer pending._", format: "markdown", buttons: [] };
}

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

export function formatInvalidInteractionCommandUsage(input: {
  readonly commandName: "allow" | "reject";
}): ChatTextInput {
  return input.commandName === "allow"
    ? markdown({
        text: [
          `**Invalid ${inlineCode("/allow")} command**`,
          "",
          `Use ${inlineCode("/allow")} to allow once, or ${inlineCode("/allow always")} to always allow matching future requests.`,
          "",
          "**Examples**",
          `- ${inlineCode("/allow")}`,
          `- ${inlineCode("/allow always")}`,
        ].join("\n"),
      })
    : markdown({
        text: [
          `**Invalid ${inlineCode("/reject")} command**`,
          "",
          `Use ${inlineCode("/reject")} with no extra text to reject the current request.`,
        ].join("\n"),
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

function formatResolvedText(input: {
  readonly kind: "permission" | "question";
  readonly action: InteractionResolvedAction;
}): string {
  if (input.kind === "question") {
    return input.action === "rejected" ? "✗ Question rejected" : "✓ Question answered";
  }

  switch (input.action) {
    case "allowed_once":
      return "✓ Permission allowed";
    case "allowed_always":
      return "✓ Permission allowed — future matching requests auto-allowed";
    case "rejected":
      return "✗ Permission rejected";
  }
}

function formatInteractionButtons(input: {
  readonly kind: "permission" | "question";
  readonly ordinal: number;
  readonly allowAlways: boolean;
}): readonly (readonly ChatButtonInput<Actions>[])[] {
  const payload = String(input.ordinal);

  if (input.kind === "question") {
    return [[rejectButton(payload)]];
  }

  const row = [allowButton(payload)];
  if (input.allowAlways) row.push(allowAlwaysButton(payload));
  row.push(rejectButton(payload));
  return [row];
}

function allowButton(payload: string): ChatButtonInput<Actions> {
  return {
    id: `interaction-allow-${payload}`,
    label: "✅ Allow",
    actionId: interactionActionId,
    value: "allow",
    payload,
    style: "primary",
  };
}

function allowAlwaysButton(payload: string): ChatButtonInput<Actions> {
  return {
    id: `interaction-always-${payload}`,
    label: "♾️ Allow always",
    actionId: interactionActionId,
    value: "always",
    payload,
    style: "secondary",
  };
}

function rejectButton(payload: string): ChatButtonInput<Actions> {
  return {
    id: `interaction-reject-${payload}`,
    label: "⛔ Reject",
    actionId: interactionActionId,
    value: "reject",
    payload,
    style: "danger",
  };
}
