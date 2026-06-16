import type { ChatCommandOption, ChatCommandRegistry, ChatCommandValues } from "@xmux/chat-core";
import type { SlackCommandEvent } from "../client";
import { slackLogEvents, type SlackLogScope } from "../logger";
import type { SlackCommandMode } from "../types";

export type SlackCommandPayloadLike = Pick<SlackCommandEvent["payload"], "command" | "text">;

export type SlackCommandParseResult<TCommands extends ChatCommandRegistry> =
  | { readonly status: "unknown"; readonly commandName: string }
  | {
      readonly status: "invalid";
      readonly commandName: string;
      readonly reason: string;
      readonly optionName?: string;
    }
  | { readonly status: "command"; readonly command: ChatCommandValues<TCommands> };

export function parseSlackCommand<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly payload: SlackCommandPayloadLike;
  readonly commandMode: SlackCommandMode;
  readonly logger?: SlackLogScope;
}): SlackCommandParseResult<TCommands> {
  const routed = routeSlackCommand(args.payload, args.commandMode);
  if (routed.status === "unknown") {
    return { status: "unknown", commandName: routed.commandName };
  }
  if (routed.status === "invalid") {
    return invalidCommand({
      logger: args.logger,
      commandName: routed.commandName,
      reason: routed.reason,
    });
  }

  const definition = args.commands[routed.commandName];
  if (definition === undefined) {
    return { status: "unknown", commandName: routed.commandName };
  }

  const parsedOptions = parseCommandOptions({
    commandName: routed.commandName,
    definition,
    input: routed.input,
    logger: args.logger,
  });
  if (parsedOptions.status === "invalid") {
    return {
      status: "invalid",
      commandName: routed.commandName,
      reason: parsedOptions.reason,
      optionName: parsedOptions.optionName,
    };
  }

  return {
    status: "command",
    command: {
      name: routed.commandName,
      options: parsedOptions.options,
    } as ChatCommandValues<TCommands>,
  };
}

function routeSlackCommand(
  payload: SlackCommandPayloadLike,
  commandMode: SlackCommandMode,
):
  | { readonly status: "routed"; readonly commandName: string; readonly input: string }
  | { readonly status: "unknown"; readonly commandName: string }
  | { readonly status: "invalid"; readonly commandName: string; readonly reason: string } {
  if (commandMode.type === "direct") {
    return {
      status: "routed",
      commandName: normalizeSlashCommandName(payload.command),
      input: payload.text.trim(),
    };
  }

  const rootCommandName = normalizeSlashCommandName(commandMode.command);
  if (normalizeSlashCommandName(payload.command) !== rootCommandName) {
    return {
      status: "unknown",
      commandName: normalizeSlashCommandName(payload.command),
    };
  }

  const routed = readFirstToken(payload.text);
  if (routed === undefined) {
    return {
      status: "invalid",
      commandName: rootCommandName,
      reason: "root command requires a command name",
    };
  }

  return {
    status: "routed",
    commandName: normalizeSlashCommandName(routed.token),
    input: routed.rest,
  };
}

function normalizeSlashCommandName(command: string): string {
  return command.trim().replace(/^\/+/, "");
}

function parseCommandOptions(args: {
  readonly commandName: string;
  readonly definition: ChatCommandRegistry[string];
  readonly input: string;
  readonly logger?: SlackLogScope;
}):
  | { readonly status: "valid"; readonly options: Record<string, unknown> }
  | { readonly status: "invalid"; readonly optionName: string; readonly reason: string } {
  const optionDefinitions = args.definition.options ?? {};
  const rawOptions = createRawCommandOptions({
    input: args.input,
    optionDefinitions,
  });
  const options: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(optionDefinitions)) {
    const rawValue = rawOptions.get(name);
    if (rawValue === undefined) {
      if (definition.required === true) {
        return invalidCommandOption({
          logger: args.logger,
          commandName: args.commandName,
          optionName: name,
          reason: "required option is missing",
        });
      }

      options[name] = undefined;
      continue;
    }

    const value = parseOptionValue({ rawValue, kind: definition.kind });
    if (value.status === "invalid") {
      return invalidCommandOption({
        logger: args.logger,
        commandName: args.commandName,
        optionName: name,
        reason: value.reason,
      });
    }

    if (definition.choices !== undefined && !definition.choices.includes(value.value as never)) {
      return invalidCommandOption({
        logger: args.logger,
        commandName: args.commandName,
        optionName: name,
        reason: `value must be one of: ${definition.choices.join(", ")}`,
      });
    }

    options[name] = value.value;
  }

  return { status: "valid", options };
}

function invalidCommand(args: {
  readonly logger?: SlackLogScope;
  readonly commandName: string;
  readonly reason: string;
}): { readonly status: "invalid"; readonly commandName: string; readonly reason: string } {
  args.logger?.warn(slackLogEvents.commandParseFailure, {
    operation: "parseCommand",
    code: "COMMAND_PARSE_FAILED",
    commandName: args.commandName,
    reason: args.reason,
  });

  return { status: "invalid", commandName: args.commandName, reason: args.reason };
}

function invalidCommandOption(args: {
  readonly logger?: SlackLogScope;
  readonly commandName: string;
  readonly optionName: string;
  readonly reason: string;
}): { readonly status: "invalid"; readonly optionName: string; readonly reason: string } {
  args.logger?.warn(slackLogEvents.commandParseFailure, {
    operation: "parseCommand",
    code: "COMMAND_PARSE_FAILED",
    commandName: args.commandName,
    optionName: args.optionName,
    reason: args.reason,
  });

  return { status: "invalid", optionName: args.optionName, reason: args.reason };
}

function createRawCommandOptions(args: {
  readonly input: string;
  readonly optionDefinitions: NonNullable<ChatCommandRegistry[string]["options"]>;
}): ReadonlyMap<string, string | true> {
  const namedOptions = tokenizeCommandOptions(args.input);
  if (namedOptions.size > 0) {
    return namedOptions;
  }

  return tokenizePositionalCommandOptions({
    input: args.input,
    optionDefinitions: args.optionDefinitions,
  });
}

function tokenizePositionalCommandOptions(args: {
  readonly input: string;
  readonly optionDefinitions: NonNullable<ChatCommandRegistry[string]["options"]>;
}): ReadonlyMap<string, string | true> {
  const entries = Object.entries(args.optionDefinitions);
  const positionalInput = args.input.trim();
  if (entries.length === 0 || positionalInput.length === 0) {
    return new Map();
  }

  const tokens = tokenize(positionalInput);
  const options = new Map<string, string | true>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as readonly [string, ChatCommandOption] | undefined;
    if (entry === undefined) {
      continue;
    }

    const [name, definition] = entry;
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    const isLastOption = index === entries.length - 1;
    const value =
      definition.kind === "string" && isLastOption ? tokens.slice(index).join(" ") : token;
    options.set(name, value);
  }

  return options;
}

function tokenizeCommandOptions(input: string): ReadonlyMap<string, string | true> {
  const tokens = tokenize(input);
  const options = new Map<string, string | true>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      continue;
    }

    const optionToken = token.slice(2);
    const equalsIndex = optionToken.indexOf("=");
    if (equalsIndex > 0) {
      options.set(optionToken.slice(0, equalsIndex), optionToken.slice(equalsIndex + 1));
      continue;
    }

    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options.set(optionToken, true);
      continue;
    }

    options.set(optionToken, next);
    index += 1;
  }

  return options;
}

function readFirstToken(
  input: string,
): { readonly token: string; readonly rest: string } | undefined {
  const start = input.length - input.trimStart().length;
  if (start >= input.length) {
    return undefined;
  }

  let token = "";
  let quote: '"' | "'" | undefined;
  let index = start;

  for (; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) {
      break;
    }

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      break;
    }

    token += character;
  }

  return token.length === 0 ? undefined : { token, rest: input.slice(index).trim() };
}

function tokenize(input: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const character of input) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseOptionValue(args: {
  readonly rawValue: string | true;
  readonly kind: "string" | "number" | "boolean";
}):
  | { readonly status: "valid"; readonly value: unknown }
  | { readonly status: "invalid"; readonly reason: string } {
  if (args.kind === "boolean") {
    if (args.rawValue === true || args.rawValue === "true") {
      return { status: "valid", value: true };
    }
    if (args.rawValue === "false") {
      return { status: "valid", value: false };
    }
    return { status: "invalid", reason: "boolean option must be true or false" };
  }

  if (args.rawValue === true) {
    return { status: "invalid", reason: `${args.kind} option requires a value` };
  }

  if (args.kind === "number") {
    const value = Number(args.rawValue);
    return Number.isFinite(value)
      ? { status: "valid", value }
      : { status: "invalid", reason: "number option must be numeric" };
  }

  return { status: "valid", value: args.rawValue };
}
