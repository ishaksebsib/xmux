import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown, markdownText } from "../../../components";
import {
  SessionCommandIncompleteTargetError,
  SessionListAllFailedError,
  SessionShortIdAmbiguousError,
  SessionShortIdNotFoundError,
} from "./errors";

export function formatIncompleteTargetError(
  error: SessionCommandIncompleteTargetError,
  inset: string,
): ChatTextInput {
  const command = error.command;
  return markdown({
    text: [
      `**Incomplete ${command} command**`,
      "",
      `- Use ${inlineCode(`/${command}`)} to ${inset}.`,
      `- Then use ${inlineCode(`/${command} <harnessId> <shortId>`)} to act on a listed session.`,
    ].join("\n"),
  });
}

export function formatShortIdNotFoundError(
  error: SessionShortIdNotFoundError,
  command: string,
  hint: string,
): ChatTextInput {
  return markdown({
    text: [
      "**Session not found**",
      "",
      `- Harness: ${inlineCode(error.harnessId)}`,
      `- Short ID: ${inlineCode(error.shortId)}`,
      `- Directory: ${inlineCode(error.cwd)}`,
      "",
      `Run ${inlineCode(`/${command}`)} ${hint}.`,
    ].join("\n"),
  });
}

export function formatShortIdAmbiguousError(
  error: SessionShortIdAmbiguousError,
  command: string,
): ChatTextInput {
  return markdown({
    text: [
      "**Short ID is ambiguous**",
      "",
      `- Harness: ${inlineCode(error.harnessId)}`,
      `- Short ID: ${inlineCode(error.shortId)}`,
      "",
      "Matching sessions:",
      error.matchingSessionIds.map((sessionId) => `- ${inlineCode(sessionId)}`).join("\n"),
      "",
      `Run ${inlineCode(`/${command}`)} again and use the displayed short ID.`,
    ].join("\n"),
  });
}

export function formatListAllFailedError(error: SessionListAllFailedError): ChatTextInput {
  return markdown({
    text: [
      `**Failed to list sessions** (${error.failures.length})`,
      "",
      ...error.failures.map(
        (failure) => `- ${inlineCode(failure.harnessId)} — ${markdownText(failure.error.message)}`,
      ),
    ].join("\n"),
  });
}

export function formatSessionCommandFailure(
  error: unknown,
  command: string,
  inset: string,
  hint: string,
): ChatTextInput | null {
  if (SessionCommandIncompleteTargetError.is(error)) {
    return formatIncompleteTargetError(error, inset);
  }

  if (SessionShortIdNotFoundError.is(error)) {
    return formatShortIdNotFoundError(error, command, hint);
  }

  if (SessionShortIdAmbiguousError.is(error)) {
    return formatShortIdAmbiguousError(error, command);
  }

  if (SessionListAllFailedError.is(error)) {
    return formatListAllFailedError(error);
  }

  return null;
}
