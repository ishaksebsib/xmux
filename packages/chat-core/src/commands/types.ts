type ChatCommandOptionKind = "string" | "number" | "boolean";

type StringChoice = string;
type NumberChoice = number;
type OptionChoices = readonly (StringChoice | NumberChoice)[];

type ChoiceValue<TChoices extends OptionChoices | undefined, TFallback> = TChoices extends readonly (
  infer TValue
)[]
  ? TValue
  : TFallback;

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

/** supported command metadata. */
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

export type ChatCommandOptionValue<TOption extends ChatCommandOption> =
  TOption extends ChatCommandOptionDefinition<ChatCommandOptionKind, infer TValue, infer TRequired>
    ? TRequired extends true
      ? TValue
      : TValue | undefined
    : never;

export type ChatCommandOptionValues<TOptions extends ChatCommandOptionsDefinition | undefined> =
  TOptions extends ChatCommandOptionsDefinition
    ? { readonly [TName in keyof TOptions]: ChatCommandOptionValue<TOptions[TName]> }
    : Record<never, never>;

export type ChatCommandValueFor<
  TCommands extends ChatCommandRegistry,
  TName extends keyof TCommands,
> = TCommands[TName] extends ChatCommandDefinition<infer TOptions>
  ? {
      readonly name: Extract<TName, string>;
      readonly options: ChatCommandOptionValues<TOptions>;
    }
  : never;

export type ChatCommandValues<TCommands extends ChatCommandRegistry> = {
  readonly [TName in keyof TCommands]: ChatCommandValueFor<TCommands, TName>;
}[keyof TCommands];

export interface ChatStringOptionInput<
  TRequired extends boolean = false,
  TChoices extends readonly string[] | undefined = undefined,
> {
  readonly description?: string;
  readonly required?: TRequired;
  readonly choices?: TChoices;
}

export interface ChatNumberOptionInput<
  TRequired extends boolean = false,
  TChoices extends readonly number[] | undefined = undefined,
> {
  readonly description?: string;
  readonly required?: TRequired;
  readonly choices?: TChoices;
}

export interface ChatBooleanOptionInput<TRequired extends boolean = false> {
  readonly description?: string;
  readonly required?: TRequired;
}

