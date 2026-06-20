import { createChat, type AdapterDataFor, type AdapterOptionsFor } from "@xmux/chat-core";
import { describe, expect, expectTypeOf, test } from "vitest";
import { createSlackAdapter } from "../../src";
import { slackAdapterCapabilities } from "../../src/capabilities";
import type { SlackAdapterData, SlackAdapterOptions } from "../../src/types";

describe("Slack adapter definition", () => {
  test("creates an adapter definition with the default id", () => {
    const adapter = createSlackAdapter();

    expect(adapter.id).toBe("slack");
    expect(adapter.capabilities).toBe(slackAdapterCapabilities);
    expect(typeof adapter.open).toBe("function");
  });

  test("preserves a custom id", () => {
    const adapter = createSlackAdapter({ id: "ops-slack" });

    expect(adapter.id).toBe("ops-slack");
  });

  test("can be registered with chat-core without opening Slack", () => {
    const chat = createChat({
      adapters: {
        slack: createSlackAdapter({ id: "slack" }),
      },
      commands: {},
    });

    expect(chat.chatIds).toEqual(["slack"]);
  });

  test("exposes the expected static capabilities", () => {
    expect(slackAdapterCapabilities).toMatchObject({
      commands: {
        registration: "manual",
        options: true,
        choices: false,
        autocomplete: false,
      },
      messages: {
        send: true,
        reply: true,
        typing: false,
        markdown: true,
        stream: { send: true, reply: true, strategy: "native" },
        attachments: {
          receive: true,
          send: false,
          download: true,
        },
      },
      reactions: { receive: true, send: false },
      actions: {
        send: true,
        receive: true,
        ack: true,
        reply: true,
        update: true,
        urlButtons: true,
        maxButtonsPerMessage: 25,
        maxButtonsPerRow: 5,
      },
    });
  });

  test("preserves adapter options and data types", () => {
    const adapter = createSlackAdapter({ id: "slack" });
    type Adapters = { readonly slack: typeof adapter };

    expectTypeOf(adapter.id).toEqualTypeOf<"slack">();
    expectTypeOf({} as AdapterOptionsFor<Adapters, "slack">).toEqualTypeOf<SlackAdapterOptions>();
    expectTypeOf({} as AdapterDataFor<Adapters, "slack">).toEqualTypeOf<SlackAdapterData>();
  });
});
