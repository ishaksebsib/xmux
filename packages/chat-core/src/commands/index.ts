import type {
  ChatBooleanOption,
  ChatBooleanOptionInput,
  ChatCommandDefinition,
  ChatCommandOptionsDefinition,
  ChatCommandRegistry,
  ChatNumberOption,
  ChatNumberOptionInput,
  ChatStringOption,
  ChatStringOptionInput,
} from "./types";

/** Defines the command registry passed unchanged to adapters during startup. */
export function defineChatCommands<const TCommands extends ChatCommandRegistry>(
  commands: TCommands,
): TCommands {
  return commands;
}

/** Defines one command without options. */
export function defineChatCommand(command: {
  readonly description: string;
}): ChatCommandDefinition<undefined>;

/** Defines one command and keeps its option metadata available for inference. */
export function defineChatCommand<const TOptions extends ChatCommandOptionsDefinition>(command: {
  readonly description: string;
  readonly options: TOptions;
}): ChatCommandDefinition<TOptions>;

export function defineChatCommand(
  command: ChatCommandDefinition<ChatCommandOptionsDefinition | undefined>,
): ChatCommandDefinition<ChatCommandOptionsDefinition | undefined> {
  return command;
}

/** Defines a string command option while preserving literal choices for handlers. */
export function stringOption<
  const TRequired extends boolean = false,
  const TChoices extends readonly string[] | undefined = undefined,
>(input: ChatStringOptionInput<TRequired, TChoices> = {}): ChatStringOption<TRequired, TChoices> {
  return {
    kind: "string",
    ...input,
  } as ChatStringOption<TRequired, TChoices>;
}

/** Defines a number command option while preserving literal choices for handlers. */
export function numberOption<
  const TRequired extends boolean = false,
  const TChoices extends readonly number[] | undefined = undefined,
>(input: ChatNumberOptionInput<TRequired, TChoices> = {}): ChatNumberOption<TRequired, TChoices> {
  return {
    kind: "number",
    ...input,
  } as ChatNumberOption<TRequired, TChoices>;
}

/** Defines a boolean command option; choices are not meaningful for booleans. */
export function booleanOption<const TRequired extends boolean = false>(
  input: ChatBooleanOptionInput<TRequired> = {},
): ChatBooleanOption<TRequired> {
  return {
    kind: "boolean",
    ...input,
  } as ChatBooleanOption<TRequired>;
}
