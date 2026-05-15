import { expectTypeOf, test } from "vitest";
import {
  booleanOption,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
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
