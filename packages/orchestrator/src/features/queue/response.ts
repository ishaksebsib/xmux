import type { ChatTextInput } from "@xmux/chat-core";
import { queueActionId } from "../../actions";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { NoActiveSessionError, SessionRecordMissingError } from "../errors";
import { formatActionButtonRows } from "../button-layout";
import type { ActionMessage } from "../utils";
import {
  PromptQueueActorMismatchError,
  PromptQueueDrainStateConflictError,
  PromptQueueFullError,
  PromptQueueInvalidCommandError,
  PromptQueueItemNotFoundError,
  PromptQueueMissingActorError,
  PromptQueueOfferNotFoundError,
  PromptQueueOfferStateConflictError,
} from "./errors";
import type { PromptQueueOffer, PromptQueuePosition, QueuedPrompt } from "./registry";
import type { QueueCommandError, QueueCommandOutput } from "./service";

const PROMPT_PREVIEW_MAX_CHARS = 180;
const QUEUE_LIST_PREVIEW_MAX_CHARS = 110;

export function formatQueueOfferAction(offer: PromptQueueOffer): ActionMessage {
  return {
    text: [
      "**Already running**",
      "",
      "Queue this prompt, or interrupt the current response and send it now.",
      "",
      "**Prompt**",
      promptPreviewCode(offer.item, PROMPT_PREVIEW_MAX_CHARS),
    ].join("\n"),
    format: "markdown",
    buttons: formatActionButtonRows([
      {
        id: `queue-add-${offer.offerId}`,
        label: "Add to queue",
        actionId: queueActionId,
        value: "add",
        payload: offer.offerId,
        style: "success",
      },
      {
        id: `queue-interrupt-${offer.offerId}`,
        label: "Interrupt & send",
        actionId: queueActionId,
        value: "interrupt",
        payload: offer.offerId,
        style: "danger",
      },
    ]),
  };
}

export function formatQueueAddedAction(position: PromptQueuePosition): ActionMessage {
  return {
    text: [
      `**Queued** · ${position.index}/${position.total}`,
      "",
      "**Prompt**",
      promptPreviewCode(position.item, PROMPT_PREVIEW_MAX_CHARS),
    ].join("\n"),
    format: "markdown",
    buttons: formatActionButtonRows([
      {
        id: `queue-remove-${position.item.itemId}`,
        label: "Remove from queue",
        actionId: queueActionId,
        value: "remove",
        payload: position.item.itemId,
        style: "danger",
      },
    ]),
  };
}

export function formatQueueRemovedBackToOfferAction(offer: PromptQueueOffer): ActionMessage {
  return formatQueueOfferAction(offer);
}

export function formatQueueInterruptedAction(): ActionMessage {
  return {
    text: "**Interrupted**\n\nPrompt sent.",
    format: "markdown",
    buttons: [],
  };
}

export function formatQueueActionUnavailableAction(error: unknown): ActionMessage {
  return {
    text: queueActionUnavailableText(error),
    format: "markdown",
    buttons: [],
  };
}

export function formatQueueCommandOutput(output: QueueCommandOutput): ChatTextInput {
  switch (output.status) {
    case "list":
      return formatQueueList(output.items);
    case "added":
      return markdown({
        text: [
          `**Queued** · ${output.index}/${output.total}`,
          "",
          "**Prompt**",
          promptPreviewCode(output.item, PROMPT_PREVIEW_MAX_CHARS),
        ].join("\n"),
      });
    case "removed":
      return markdown({
        text: `**Removed**\n\n${output.remaining} prompt${output.remaining === 1 ? "" : "s"} left.`,
      });
  }
}

export function formatQueueCommandFailure(error: QueueCommandError): ChatTextInput {
  if (NoActiveSessionError.is(error)) {
    return markdown({
      text: "**No active session**\n\nStart or resume a session before using the queue.",
    });
  }

  if (SessionRecordMissingError.is(error)) {
    return markdown({ text: "**Queue unavailable**\n\nThe active session record is missing." });
  }

  if (PromptQueueFullError.is(error)) {
    return markdown({ text: `**Queue full**\n\nLimit: ${error.maxItems} prompts.` });
  }

  if (PromptQueueInvalidCommandError.is(error)) {
    return markdown({ text: ["**Invalid queue command**", "", queueUsageLines()].join("\n") });
  }

  if (PromptQueueItemNotFoundError.is(error)) {
    return markdown({ text: "**Not found**\n\nNo queued prompt at that position." });
  }

  if (PromptQueueActorMismatchError.is(error)) {
    return markdown({
      text: "**Not allowed**\n\nOnly the original sender can change this prompt.",
    });
  }

  if (PromptQueueMissingActorError.is(error)) {
    return markdown({ text: "**Cannot queue prompt**\n\nOnly user messages can be queued." });
  }

  if (PromptQueueOfferNotFoundError.is(error) || PromptQueueOfferStateConflictError.is(error)) {
    return markdown({ text: queueActionUnavailableText(error) });
  }

  return markdown({
    text: ["**Queue request failed**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatQueueCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/queue",
    summary: "manage queued prompts",
    description: "Queue prompts for the active session.",
    usage: "/queue [add <prompt>|remove <position>]",
    examples: ["/queue", "/queue add summarize the last error", "/queue remove 2"],
  });
}

function formatQueueList(items: readonly QueuedPrompt[]): ChatTextInput {
  if (items.length === 0) {
    return markdown({
      text: ["**Queue empty**", "", queueUsageLines()].join("\n"),
    });
  }

  const lines = [`**Prompt queue** · ${items.length}`, ""];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    lines.push(
      `${index + 1}/${items.length} — ${promptPreviewCode(item, QUEUE_LIST_PREVIEW_MAX_CHARS)}`,
    );
  }

  lines.push("", queueUsageLines());

  return markdown({ text: lines.join("\n") });
}

function queueActionUnavailableText(error: unknown): string {
  if (PromptQueueActorMismatchError.is(error)) {
    return "**Not allowed**\n\nOnly the original sender can change this prompt.";
  }

  if (PromptQueueOfferNotFoundError.is(error)) {
    return "**Action expired**\n\nSend the prompt again.";
  }

  if (PromptQueueItemNotFoundError.is(error)) {
    return "**Already removed**\n\nThis prompt is no longer in the queue.";
  }

  if (PromptQueueFullError.is(error)) {
    return `**Queue full**\n\nLimit: ${error.maxItems} prompts.`;
  }

  if (PromptQueueDrainStateConflictError.is(error)) {
    return "**Queue busy**\n\nTry again in a moment.";
  }

  if (PromptQueueOfferStateConflictError.is(error)) {
    switch (error.state) {
      case "sent":
        return "**Already sent**\n\nThis prompt has already left the queue.";
      case "queued":
        return "**Already queued**\n\nUse **Remove from queue** to undo.";
      case "offered":
        return "**Not queued**\n\nAdd it again if you still want to queue it.";
    }
  }

  return ["**Queue action failed**", "", markdownText(errorMessage(error))].join("\n");
}

function queueUsageLines(): string {
  return [
    `Add: ${inlineCode("/queue add <prompt>")}`,
    `Remove: ${inlineCode("/queue remove <position>")}`,
  ].join("\n");
}

function promptPreviewCode(item: QueuedPrompt, maxChars: number): string {
  return inlineCode(promptPreview(item, maxChars));
}

function promptPreview(item: QueuedPrompt, maxChars: number): string {
  const text = item.text.trim();
  const attachmentSummary =
    item.attachments.length === 0
      ? ""
      : ` [${item.attachments.length} attachment${item.attachments.length === 1 ? "" : "s"}]`;
  const base = text.length === 0 ? "(attachment-only prompt)" : text;
  const withAttachments = `${base}${attachmentSummary}`;

  if (withAttachments.length <= maxChars) return withAttachments;
  return `${withAttachments.slice(0, maxChars).trimEnd()}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
