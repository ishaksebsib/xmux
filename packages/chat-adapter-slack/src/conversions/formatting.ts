import { Result } from "better-result";
import { SlackFormattingError } from "../errors";
import type { SlackAdapterOptions } from "../types";

export interface SlackFormattedText {
  readonly text: string;
  readonly mrkdwn: boolean;
}

export function formatSlackText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions?: SlackAdapterOptions;
}): Result<SlackFormattedText, SlackFormattingError> {
  switch (args.format) {
    case undefined:
    case "plain":
      return Result.ok({ text: escapeSlackText(args.text), mrkdwn: false });
    case "markdown":
      return Result.ok({ text: convertMarkdownToSlackMrkdwn(args.text), mrkdwn: true });
    case "html":
      return Result.ok({ text: stripSlackHtml(args.text), mrkdwn: false });
  }
}

/** Escapes Slack's special text entities. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts a conservative Markdown subset to Slack mrkdwn.
 * Slack mrkdwn is not CommonMark; unsupported syntax is left as escaped text.
 */
export function convertMarkdownToSlackMrkdwn(text: string): string {
  return convertMarkdownLinks(text)
    .split(markdownLinkPlaceholderPattern)
    .map((segment) =>
      isMarkdownLinkPlaceholder(segment) ? restoreLink(segment) : escapeMarkdownSegment(segment),
    )
    .join("");
}

export function stripSlackHtml(html: string): string {
  return escapeSlackText(
    decodeBasicHtmlEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\n{2,}/g, "\n")
        .trim(),
    ),
  );
}

const markdownLinkPattern = /\[([^\]\n]+)]\((https?:\/\/[^\s)]+)\)/g;
const markdownLinkPlaceholderPattern = /(§SLACK_LINK_\d+§)/g;
const markdownLinks = new Map<string, string>();
let markdownLinkIndex = 0;

function convertMarkdownLinks(text: string): string {
  markdownLinks.clear();
  markdownLinkIndex = 0;

  return text.replace(markdownLinkPattern, (_match, label: string, url: string) => {
    const key = `§SLACK_LINK_${markdownLinkIndex++}§`;
    markdownLinks.set(key, `<${escapeSlackLinkUrl(url)}|${escapeSlackText(label)}>`);
    return key;
  });
}

function isMarkdownLinkPlaceholder(segment: string): boolean {
  return markdownLinks.has(segment);
}

function restoreLink(segment: string): string {
  return markdownLinks.get(segment) ?? segment;
}

function escapeMarkdownSegment(segment: string): string {
  return escapeSlackText(segment)
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "_$1_");
}

function escapeSlackLinkUrl(url: string): string {
  return escapeSlackText(url).replace(/\|/g, "%7C");
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
