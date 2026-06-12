import { describe, expect, test } from "vitest";
import {
  booleanOption,
  createChat,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
} from "../src";
import { commands, createRuntimeAdapter } from "./fixtures/test-adapter";

describe("chat commands", () => {
  test("defineChatCommand and defineChatCommands preserve descriptions and options", () => {
    const registry = defineChatCommands({
      start: defineChatCommand({
        description: "Start a session",
        options: {
          cwd: stringOption({ required: false }),
          harness: stringOption({ required: true, choices: ["opencode", "pi"] as const }),
          retries: numberOption({ choices: [1, 2] as const }),
          dryRun: booleanOption({ required: true }),
        },
      }),
    });

    expect(registry.start?.description).toBe("Start a session");
    expect(registry.start?.options?.cwd?.required).toBe(false);
    expect(registry.start?.options?.harness?.required).toBe(true);
    expect(registry.start?.options?.harness?.choices).toEqual(["opencode", "pi"]);
    expect(registry.start?.options?.retries?.choices).toEqual([1, 2]);
    expect(registry.start?.options?.dryRun?.required).toBe(true);
  });

  test("command registry is passed to adapter start context", async () => {
    const seenCommands: string[] = [];
    const chat = createChat({
      adapters: {
        alpha: createRuntimeAdapter({
          id: "alpha",
          onStart: (context) => {
            seenCommands.push(context.commands.start?.description ?? "missing");
          },
        }),
      },
      commands,
    });

    expect((await chat.start()).isOk()).toBe(true);
    expect(seenCommands).toEqual(["Start"]);
  });
});
