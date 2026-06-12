import type { ChatCommandOption, ChatCommandRegistry, ChatCommandValues } from "@xmux/chat-core";
import type { TelegramTextMessageContext } from "../client";

export type TelegramCommandParseResult<TCommands extends ChatCommandRegistry> =
  | { readonly status: "not_command" }
  | { readonly status: "command_for_other_bot" }
  | { readonly status: "unknown"; readonly commandName: string }
  | {
      readonly status: "invalid";
      readonly commandName: string;
      readonly reason: string;
      readonly optionName?: string;
    }
  | { readonly status: "command"; readonly command: ParsedTelegramCommand<TCommands> };

type ParsedTelegramCommand<TCommands extends ChatCommandRegistry> = ChatCommandValues<TCommands>;

export function parseTelegramCommand<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly context: TelegramTextMessageContext;
  readonly botUsername: string;
}): TelegramCommandParseResult<TCommands> {
  const commandToken = readBotCommandToken(args.context.message);
  if (commandToken === undefined) {
    return { status: "not_command" };
  }

  const parsedToken = parseCommandToken({ token: commandToken, botUsername: args.botUsername });
  if (parsedToken.status === "for_other_bot") {
    return { status: "command_for_other_bot" };
  }

  const command = args.commands[parsedToken.name];
  if (command === undefined) {
    return { status: "unknown", commandName: parsedToken.name };
  }

  const parsedOptions = parseCommandOptions({
    commandName: parsedToken.name,
    definition: command,
    input: args.context.message.text.slice(commandToken.length).trim(),
  });
  if (parsedOptions.status === "invalid") {
    return {
      status: "invalid",
      commandName: parsedToken.name,
      reason: parsedOptions.reason,
      optionName: parsedOptions.optionName,
    };
  }

  return {
    status: "command",
    command: {
      name: parsedToken.name,
      options: parsedOptions.options,
    } as ParsedTelegramCommand<TCommands>,
  };
}

function readBotCommandToken(message: TelegramTextMessageContext["message"]): string | undefined {
  const entity = message.entities?.find(
    (candidate) => candidate.type === "bot_command" && candidate.offset === 0,
  );

  return entity === undefined ? undefined : message.text.slice(0, entity.length);
}

function parseCommandToken(args: {
  readonly token: string;
  readonly botUsername: string;
}):
  | { readonly status: "current_bot"; readonly name: string }
  | { readonly status: "for_other_bot" } {
  const [nameWithSlash, mention] = args.token.split("@");
  const name = nameWithSlash?.slice(1) ?? "";

  if (mention !== undefined && mention.toLowerCase() !== args.botUsername.toLowerCase()) {
    return { status: "for_other_bot" };
  }

  return { status: "current_bot", name };
}

function parseCommandOptions(args: {
  readonly commandName: string;
  readonly definition: ChatCommandRegistry[string];
  readonly input: string;
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
        return { status: "invalid", optionName: name, reason: "required option is missing" };
      }

      options[name] = undefined;
      continue;
    }

    const value = parseOptionValue({ rawValue, kind: definition.kind });
    if (value.status === "invalid") {
      return { status: "invalid", optionName: name, reason: value.reason };
    }

    if (definition.choices !== undefined && !definition.choices.includes(value.value as never)) {
      const reason = `value must be one of: ${definition.choices.join(", ")}`;
      return { status: "invalid", optionName: name, reason };
    }

    options[name] = value.value;
  }

  return { status: "valid", options };
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

    const name = token.slice(2);
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options.set(name, true);
      continue;
    }

    options.set(name, next);
    index += 1;
  }

  return options;
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
    if (args.rawValue === true) {
      return { status: "valid", value: true };
    }
    if (args.rawValue === "true") {
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
