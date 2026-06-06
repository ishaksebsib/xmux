type ChatCommandOptionKind = "string" | "number" | "boolean";

type StringChoice = string;
type NumberChoice = number;
type OptionChoices = readonly (StringChoice | NumberChoice)[];

type ChoiceValue<
  TChoices extends OptionChoices | undefined,
  TFallback,
> = TChoices extends readonly (infer TValue)[] ? TValue : TFallback;

/** Shared metadata adapters use to register or describe command options. */
export interface ChatCommandOptionDefinition<
  TKind extends ChatCommandOptionKind,
  TValue,
  TRequired extends boolean = boolean,
> {
  readonly kind: TKind;
  readonly description?: string;
  readonly required?: TRequired;
  readonly choices?: readonly TValue[];
}

/** String option definition; choices narrow the value type when provided. */
export type ChatStringOption<
  TRequired extends boolean = boolean,
  TChoices extends readonly string[] | undefined = readonly string[] | undefined,
> = ChatCommandOptionDefinition<"string", ChoiceValue<TChoices, string>, TRequired>;

/** Number option definition; choices narrow the value type when provided. */
export type ChatNumberOption<
  TRequired extends boolean = boolean,
  TChoices extends readonly number[] | undefined = readonly number[] | undefined,
> = ChatCommandOptionDefinition<"number", ChoiceValue<TChoices, number>, TRequired>;

/** Boolean option definition; required controls whether handlers see undefined. */
export type ChatBooleanOption<TRequired extends boolean = boolean> = ChatCommandOptionDefinition<
  "boolean",
  boolean,
  TRequired
>;

/** Any supported command option metadata. */
export type ChatCommandOption = ChatStringOption | ChatNumberOption | ChatBooleanOption;

/** Option map for a single command, keyed by stable option name. */
export type ChatCommandOptionsDefinition = Record<string, ChatCommandOption>;

/** Platform-neutral command metadata passed to every adapter at startup. */
export interface ChatCommandDefinition<
  TOptions extends ChatCommandOptionsDefinition | undefined =
    | ChatCommandOptionsDefinition
    | undefined,
> {
  readonly description: string;
  readonly options?: TOptions;
}

/** Command map passed unchanged to adapters during startup. */
export type ChatCommandRegistry = Record<
  string,
  ChatCommandDefinition<ChatCommandOptionsDefinition | undefined>
>;

/** Runtime value type inferred from one command option. */
export type ChatCommandOptionValue<TOption extends ChatCommandOption> =
  TOption extends ChatCommandOptionDefinition<ChatCommandOptionKind, infer TValue, infer TRequired>
    ? TRequired extends true
      ? TValue
      : TValue | undefined
    : never;

/** Runtime option values inferred from a command option map. */
export type ChatCommandOptionValues<TOptions extends ChatCommandOptionsDefinition | undefined> =
  TOptions extends ChatCommandOptionsDefinition
    ? { readonly [TName in keyof TOptions]: ChatCommandOptionValue<TOptions[TName]> }
    : Record<never, never>;

/** Command invocation shape inferred for one command name. */
export type ChatCommandValueFor<
  TCommands extends ChatCommandRegistry,
  TName extends keyof TCommands,
> =
  TCommands[TName] extends ChatCommandDefinition<infer TOptions>
    ? {
        readonly name: Extract<TName, string>;
        readonly options: ChatCommandOptionValues<TOptions>;
      }
    : never;

/** Command invocation union inferred from a command registry. */
export type ChatCommandValues<TCommands extends ChatCommandRegistry> = {
  readonly [TName in keyof TCommands]: ChatCommandValueFor<TCommands, TName>;
}[keyof TCommands];

/** Input accepted by `stringOption()`. */
export interface ChatStringOptionInput<
  TRequired extends boolean = false,
  TChoices extends readonly string[] | undefined = undefined,
> {
  readonly description?: string;
  readonly required?: TRequired;
  readonly choices?: TChoices;
}

/** Input accepted by `numberOption()`. */
export interface ChatNumberOptionInput<
  TRequired extends boolean = false,
  TChoices extends readonly number[] | undefined = undefined,
> {
  readonly description?: string;
  readonly required?: TRequired;
  readonly choices?: TChoices;
}

/** Input accepted by `booleanOption()`. */
export interface ChatBooleanOptionInput<TRequired extends boolean = false> {
  readonly description?: string;
  readonly required?: TRequired;
}

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
