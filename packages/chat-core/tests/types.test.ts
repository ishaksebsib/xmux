import { Result } from "better-result";
import { expectTypeOf, test } from "vitest";
import {
  booleanOption,
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
  type AdapterDataFor,
  type AdapterOptionsFor,
  type ChatAdapterDefinitions,
  type ChatOn,
} from "../src";
import type { ChatCommandValues } from "../src/commands";

test("command options infer required, optional, and choice values", () => {
  const commands = defineChatCommands({
    start: defineChatCommand({
      description: "Start a session",
      options: {
        cwd: stringOption({ required: false }),
        harness: stringOption({
          required: true,
          choices: ["opencode", "pi"] as const,
        }),
        retries: numberOption({ choices: [1, 2] as const }),
        dryRun: booleanOption({ required: true }),
      },
    }),
    close: defineChatCommand({
      description: "Close the current session",
    }),
  });

  type Command = ChatCommandValues<typeof commands>;
  type StartCommand = Extract<Command, { readonly name: "start" }>;
  type CloseCommand = Extract<Command, { readonly name: "close" }>;

  expectTypeOf({} as StartCommand["options"]["cwd"]).toEqualTypeOf<string | undefined>();
  expectTypeOf({} as StartCommand["options"]["harness"]).toEqualTypeOf<"opencode" | "pi">();
  expectTypeOf({} as StartCommand["options"]["retries"]).toEqualTypeOf<1 | 2 | undefined>();
  expectTypeOf({} as StartCommand["options"]["dryRun"]).toEqualTypeOf<boolean>();
  expectTypeOf<keyof CloseCommand["options"]>().toEqualTypeOf<never>();
});

test("adapter helper preserves id, option, and data types", () => {
  const discord = defineChatAdapter<
    "discord",
    { readonly allowedMentions: boolean },
    { readonly nativeMessageId: string }
  >({
    id: "discord",
    async open() {
      return Result.ok({
        id: "discord" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "discord" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            format: input.format,
            adapterData: { nativeMessageId: "native-1" },
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  type Adapters = { readonly discord: typeof discord };
  const adapters = { discord } satisfies ChatAdapterDefinitions<Adapters>;

  expectTypeOf(adapters.discord.id).toEqualTypeOf<"discord">();
  expectTypeOf({} as AdapterOptionsFor<Adapters, "discord">).toEqualTypeOf<{
    readonly allowedMentions: boolean;
  }>();
  expectTypeOf({} as AdapterDataFor<Adapters, "discord">).toEqualTypeOf<{
    readonly nativeMessageId: string;
  }>();
});

test("command event handlers narrow by command name", () => {
  const commands = defineChatCommands({
    start: defineChatCommand({
      description: "Start a session",
      options: {
        cwd: stringOption({ required: false }),
      },
    }),
    close: defineChatCommand({
      description: "Close the current session",
    }),
  });

  function assertHandlers(on: ChatOn<typeof commands>) {
    on("command", "start", (event) => {
      expectTypeOf(event.command.name).toEqualTypeOf<"start">();
      expectTypeOf(event.command.options.cwd).toEqualTypeOf<string | undefined>();
    });

    on("command", (event) => {
      expectTypeOf(event.command.name).toEqualTypeOf<"start" | "close">();
    });
  }

  void assertHandlers;
});
