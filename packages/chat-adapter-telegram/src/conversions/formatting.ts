import telegramifyMarkdown from "telegramify-markdown";
import type { ChatMessageFormat } from "@xmux/chat-core";
import type { TelegramAdapterOptions } from "../types";

export function encodeTelegramFormattedText(args: {
  readonly text: string;
  readonly format: ChatMessageFormat | undefined;
  readonly adapterOptions?: TelegramAdapterOptions;
}): { readonly text: string; readonly options: TelegramAdapterOptions } {
  if (args.format === "markdown" && args.adapterOptions?.parse_mode === undefined) {
    return {
      text: encodeTelegramMarkdownText(args.text),
      options: encodeTelegramFormatOptions(args.format),
    };
  }

  return { text: args.text, options: encodeTelegramFormatOptions(args.format) };
}

export function encodeTelegramFormatOptions(
  format: ChatMessageFormat | undefined,
): TelegramAdapterOptions {
  if (format === "html") {
    return { parse_mode: "HTML" };
  }

  if (format === "markdown") {
    return { parse_mode: "MarkdownV2" };
  }

  return {};
}

export function encodeTelegramMarkdownText(text: string): string {
  return stripGeneratedTrailingNewline({
    originalText: text,
    convertedText: telegramifyMarkdown(text, "escape"),
  });
}

function stripGeneratedTrailingNewline(args: {
  readonly originalText: string;
  readonly convertedText: string;
}): string {
  return args.originalText.endsWith("\n")
    ? args.convertedText
    : args.convertedText.replace(/\n$/, "");
}
