import { Result } from "better-result";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { ChatCommandOption, ChatCommandRegistry } from "@xmux/chat-core";
import { DiscordCommandRegistrationError } from "../errors";
import { discordLogEvents, type DiscordLogScope } from "../logger";

const discordCommandNamePattern = /^[a-z0-9_-]{1,32}$/;
const maxDescriptionLength = 100;
const maxOptions = 25;
const maxChoices = 25;
const maxChoiceNameLength = 100;
const maxStringChoiceLength = 100;

export interface DiscordSkippedCommandRegistration {
  readonly commandName: string;
  readonly optionName?: string;
  readonly code: string;
  readonly reason: string;
}

export interface DiscordCommandRegistrationPayload {
  readonly commands: readonly RESTPostAPIApplicationCommandsJSONBody[];
  readonly skipped: readonly DiscordSkippedCommandRegistration[];
}

export function createDiscordCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly logger?: DiscordLogScope;
}): Result<DiscordCommandRegistrationPayload, DiscordCommandRegistrationError> {
  const discordCommands: RESTPostAPIApplicationCommandsJSONBody[] = [];
  const skipped: DiscordSkippedCommandRegistration[] = [];

  for (const [name, command] of Object.entries(args.commands)) {
    const description = command.description.trim();
    const validation = validateCommand({ name, description });
    if (validation !== undefined) {
      const skip = { commandName: name, ...validation };
      skipped.push(skip);
      warn(args.logger, skip);
      continue;
    }

    const options = command.options ?? {};
    const entries = sortOptionEntries(Object.entries(options));
    if (entries.length > maxOptions) {
      const skip = {
        code: "COMMAND_OPTIONS_TOO_MANY",
        commandName: name,
        reason: "command_options_too_many",
      };
      skipped.push(skip);
      warn(args.logger, skip);
      continue;
    }

    const discordOptions = createDiscordCommandOptions({
      commandName: name,
      entries,
      logger: args.logger,
    });
    if (discordOptions.status === "invalid") {
      skipped.push(discordOptions.skipped);
      continue;
    }

    discordCommands.push({
      type: ApplicationCommandType.ChatInput,
      name,
      description,
      options: discordOptions.options,
    });
  }

  return Result.ok({ commands: discordCommands, skipped });
}

function createDiscordCommandOptions(args: {
  readonly commandName: string;
  readonly entries: readonly (readonly [string, ChatCommandOption])[];
  readonly logger?: DiscordLogScope;
}):
  | {
      readonly status: "valid";
      readonly options: NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]>;
    }
  | { readonly status: "invalid"; readonly skipped: DiscordSkippedCommandRegistration } {
  const discordOptions: NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]> = [];

  for (const [name, option] of args.entries) {
    const description = (option.description ?? name).trim();
    const validation = validateOption({ name, option, description });
    if (validation !== undefined) {
      const skipped = {
        commandName: args.commandName,
        optionName: name,
        ...validation,
      };
      warn(args.logger, skipped);
      return { status: "invalid", skipped };
    }

    const choices = option.choices?.map((choice) => ({
      name: String(choice).trim(),
      value: choice,
    }));
    discordOptions.push({
      type: optionType(option.kind),
      name,
      description,
      required: option.required,
      ...(choices === undefined ? {} : { choices }),
    } as NonNullable<RESTPostAPIApplicationCommandsJSONBody["options"]>[number]);
  }

  return { status: "valid", options: discordOptions };
}

function sortOptionEntries(
  entries: readonly (readonly [string, ChatCommandOption])[],
): readonly (readonly [string, ChatCommandOption])[] {
  return [...entries].sort(
    ([, a], [, b]) => Number(b.required === true) - Number(a.required === true),
  );
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
  readonly description: string;
}): { readonly code: string; readonly reason: string } | undefined {
  if (!discordCommandNamePattern.test(args.name)) {
    return { code: "COMMAND_OPTION_NAME_INVALID", reason: "command_option_name_invalid" };
  }

  if (args.description.length === 0 || args.description.length > maxDescriptionLength) {
    return {
      code: "COMMAND_OPTION_DESCRIPTION_INVALID",
      reason: "command_option_description_invalid",
    };
  }

  const choices = args.option.choices ?? [];
  if (choices.length > maxChoices) {
    return { code: "COMMAND_OPTION_CHOICES_TOO_MANY", reason: "command_option_choices_too_many" };
  }

  if (choices.some((choice) => String(choice).trim().length === 0)) {
    return {
      code: "COMMAND_OPTION_CHOICE_NAME_INVALID",
      reason: "command_option_choice_name_invalid",
    };
  }

  if (choices.some((choice) => String(choice).trim().length > maxChoiceNameLength)) {
    return {
      code: "COMMAND_OPTION_CHOICE_NAME_TOO_LONG",
      reason: "command_option_choice_name_too_long",
    };
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

  if (args.option.kind === "number" && choices.some((choice) => !Number.isFinite(choice))) {
    return {
      code: "COMMAND_OPTION_CHOICE_NUMBER_INVALID",
      reason: "command_option_choice_number_invalid",
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
  metadata: DiscordSkippedCommandRegistration,
): void {
  logger?.warn(discordLogEvents.commandsRegisterWarning, {
    operation: "registerCommands",
    ...metadata,
  });
}
