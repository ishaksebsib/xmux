import { Result } from "better-result";
import { DiscordFormattingError } from "../errors";
import type { DiscordAdapterOptions } from "../types";

const discordMarkdownCharacters = /([\\`*_{}\x5B\x5D()#+\-.!|>~])/g;

export function formatDiscordText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions?: DiscordAdapterOptions;
}): Result<string, DiscordFormattingError> {
  switch (args.format) {
    case undefined:
    case "plain":
      return Result.ok(escapeDiscordMarkdown(args.text));
    case "markdown":
      return Result.ok(args.text);
    case "html":
      return Result.err(
        new DiscordFormattingError({
          format: "html",
          reason: "Discord adapter does not support HTML message formatting",
        }),
      );
  }
}

export function escapeDiscordMarkdown(text: string): string {
  return text.replace(discordMarkdownCharacters, "\\$1");
}
