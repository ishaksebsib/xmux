import type { ChatCommandOption, ChatCommandRegistry, ChatCommandValues } from "@xmux/chat-core";
import { discordLogEvents, type DiscordLogScope } from "../logger";
import { encodeDiscordCommandOptionName } from "./registration";

export type DiscordCommandParseResult<TCommands extends ChatCommandRegistry> =
  | { readonly status: "unknown"; readonly commandName: string }
  | {
      readonly status: "invalid";
      readonly commandName: string;
      readonly reason: string;
      readonly optionName?: string;
    }
  | { readonly status: "command"; readonly command: ChatCommandValues<TCommands> };

export interface DiscordChatInputInteractionLike {
  readonly commandName: string;
  readonly options?: {
    get(name: string): { readonly value?: unknown } | null;
  };
}

export function parseDiscordCommand<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly interaction: DiscordChatInputInteractionLike;
  readonly logger?: DiscordLogScope;
}): DiscordCommandParseResult<TCommands> {
  const commandName = args.interaction.commandName;
  const definition = args.commands[commandName];
  if (definition === undefined) {
    return { status: "unknown", commandName };
  }

  const options: Record<string, unknown> = {};
  for (const [name, option] of Object.entries(definition.options ?? {})) {
    const discordName = encodeDiscordCommandOptionName(name);
    const rawValue = args.interaction.options?.get(discordName)?.value;
    if (rawValue === undefined || rawValue === null) {
      if (option.required === true) {
        return invalidCommandOption({
          logger: args.logger,
          commandName,
          optionName: name,
          reason: "required option is missing",
        });
      }

      options[name] = undefined;
      continue;
    }

    const parsed = parseOptionValue({ value: rawValue, option });
    if (parsed.status === "invalid") {
      return invalidCommandOption({
        logger: args.logger,
        commandName,
        optionName: name,
        reason: parsed.reason,
      });
    }

    if (option.choices !== undefined && !option.choices.includes(parsed.value as never)) {
      return invalidCommandOption({
        logger: args.logger,
        commandName,
        optionName: name,
        reason: `value must be one of: ${option.choices.join(", ")}`,
      });
    }

    options[name] = parsed.value;
  }

  return {
    status: "command",
    command: { name: commandName, options } as ChatCommandValues<TCommands>,
  };
}

function parseOptionValue(args: {
  readonly value: unknown;
  readonly option: ChatCommandOption;
}):
  | { readonly status: "valid"; readonly value: unknown }
  | { readonly status: "invalid"; readonly reason: string } {
  switch (args.option.kind) {
    case "string":
      return typeof args.value === "string"
        ? { status: "valid", value: args.value }
        : { status: "invalid", reason: "string option must be a string" };
    case "number":
      return typeof args.value === "number" && Number.isFinite(args.value)
        ? { status: "valid", value: args.value }
        : { status: "invalid", reason: "number option must be numeric" };
    case "boolean":
      return typeof args.value === "boolean"
        ? { status: "valid", value: args.value }
        : { status: "invalid", reason: "boolean option must be boolean" };
  }
}

function invalidCommandOption(args: {
  readonly logger?: DiscordLogScope;
  readonly commandName: string;
  readonly optionName: string;
  readonly reason: string;
}): {
  readonly status: "invalid";
  readonly commandName: string;
  readonly optionName: string;
  readonly reason: string;
} {
  args.logger?.warn(discordLogEvents.inboundIgnored, {
    operation: "parseCommand",
    code: "COMMAND_PARSE_FAILED",
    commandName: args.commandName,
    optionName: args.optionName,
    reason: args.reason,
  });

  return {
    status: "invalid",
    commandName: args.commandName,
    optionName: args.optionName,
    reason: args.reason,
  };
}
