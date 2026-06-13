import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { ChatCommandOption, ChatCommandRegistry } from "@xmux/chat-core";
import { discordLogEvents, type DiscordLogScope } from "../logger";

const discordCommandNamePattern = /^[a-z0-9_-]{1,32}$/;
const maxDescriptionLength = 100;
const maxOptions = 25;
const maxChoices = 25;
const maxStringChoiceLength = 100;

export function createDiscordCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly logger?: DiscordLogScope;
}): readonly RESTPostAPIApplicationCommandsJSONBody[] {
  const discordCommands: RESTPostAPIApplicationCommandsJSONBody[] = [];

  for (const [name, command] of Object.entries(args.commands)) {
    const validation = validateCommand({ name, description: command.description });
    if (validation !== undefined) {
      warn(args.logger, { code: validation.code, commandName: name, reason: validation.reason });
      continue;
    }

    const options = command.options ?? {};
    const entries = Object.entries(options);
    if (entries.length > maxOptions) {
      warn(args.logger, {
        code: "COMMAND_OPTIONS_TOO_MANY",
        commandName: name,
        reason: "command_options_too_many",
      });
      continue;
    }

    const discordOptions = createDiscordCommandOptions({
      commandName: name,
      options,
      logger: args.logger,
    });
    if (discordOptions.status === "invalid") {
      continue;
    }

    discordCommands.push({
      type: ApplicationCommandType.ChatInput,
      name,
      description: command.description,
      options: discordOptions.options,
    });
  }

  return discordCommands;
}

function createDiscordCommandOptions(args: {
  readonly commandName: string;
  readonly options: NonNullable<ChatCommandRegistry[string]["options"]>;
  readonly logger?: DiscordLogScope;
}):
  | {
      readonly status: "valid";
      readonly options: NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]>;
    }
  | { readonly status: "invalid" } {
  const discordOptions: NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]> = [];

  for (const [name, option] of Object.entries(args.options)) {
    const validation = validateOption({ name, option });
    if (validation !== undefined) {
      warn(args.logger, {
        code: validation.code,
        commandName: args.commandName,
        optionName: name,
        reason: validation.reason,
      });
      return { status: "invalid" };
    }

    const choices = option.choices?.map((choice) => ({ name: String(choice), value: choice }));
    discordOptions.push({
      type: optionType(option.kind),
      name,
      description: option.description ?? name,
      required: option.required,
      ...(choices === undefined ? {} : { choices }),
    } as NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]>[number]);
  }

  return { status: "valid", options: discordOptions };
}

function validateCommand(args: {
  readonly name: string;
  readonly description: string;
}): { readonly code: string; readonly reason: string } | undefined {
  if (!discordCommandNamePattern.test(args.name)) {
    return { code: "COMMAND_NAME_INVALID", reason: "command_name_invalid" };
  }

  if (args.description.length === 0 || args.description.length > maxDescriptionLength) {
    return { code: "COMMAND_DESCRIPTION_INVALID", reason: "command_description_invalid" };
  }

  return undefined;
}

function validateOption(args: {
  readonly name: string;
  readonly option: ChatCommandOption;
}): { readonly code: string; readonly reason: string } | undefined {
  if (!discordCommandNamePattern.test(args.name)) {
    return { code: "COMMAND_OPTION_NAME_INVALID", reason: "command_option_name_invalid" };
  }

  const description = args.option.description ?? args.name;
  if (description.length === 0 || description.length > maxDescriptionLength) {
    return {
      code: "COMMAND_OPTION_DESCRIPTION_INVALID",
      reason: "command_option_description_invalid",
    };
  }

  const choices = args.option.choices ?? [];
  if (choices.length > maxChoices) {
    return { code: "COMMAND_OPTION_CHOICES_TOO_MANY", reason: "command_option_choices_too_many" };
  }

  if (
    args.option.kind === "string" &&
    choices.some((choice) => typeof choice === "string" && choice.length > maxStringChoiceLength)
  ) {
    return {
      code: "COMMAND_OPTION_CHOICE_VALUE_TOO_LONG",
      reason: "command_option_choice_value_too_long",
    };
  }

  return undefined;
}

function optionType(kind: ChatCommandOption["kind"]): ApplicationCommandOptionType {
  switch (kind) {
    case "string":
      return ApplicationCommandOptionType.String;
    case "number":
      return ApplicationCommandOptionType.Number;
    case "boolean":
      return ApplicationCommandOptionType.Boolean;
  }
}

function warn(
  logger: DiscordLogScope | undefined,
  metadata: {
    readonly code: string;
    readonly commandName: string;
    readonly optionName?: string;
    readonly reason: string;
  },
): void {
  logger?.warn(discordLogEvents.commandsRegisterWarning, {
    operation: "registerCommands",
    ...metadata,
  });
}
