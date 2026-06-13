import { createChat } from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createDiscordAdapter } from "../../src";
import { discordAdapterCapabilities } from "../../src/capabilities";

describe("Discord adapter definition", () => {
  test("creates an adapter definition with the default id", () => {
    const adapter = createDiscordAdapter({ token: "bot-token", applicationId: "application-id" });

    expect(adapter.id).toBe("discord");
    expect(adapter.capabilities).toBe(discordAdapterCapabilities);
    expect(typeof adapter.open).toBe("function");
  });

  test("preserves a custom id", () => {
    const adapter = createDiscordAdapter({
      id: "ops-discord",
      token: "bot-token",
      applicationId: "application-id",
    });

    expect(adapter.id).toBe("ops-discord");
  });

  test("can be registered with chat-core without opening Discord", () => {
    const chat = createChat({
      adapters: {
        discord: createDiscordAdapter({ token: "bot-token", applicationId: "application-id" }),
      },
      commands: {},
    });

    expect(chat.chatIds).toEqual(["discord"]);
  });

  test("exposes the expected static capabilities", () => {
    expect(discordAdapterCapabilities).toMatchObject({
      commands: {
        registration: "dynamic",
        options: true,
        choices: true,
        autocomplete: false,
      },
      messages: {
        send: true,
        reply: true,
        typing: true,
        markdown: true,
        stream: { send: true, reply: true, strategy: "edit" },
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
});
