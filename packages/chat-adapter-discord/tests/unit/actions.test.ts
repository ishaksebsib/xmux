import { ButtonStyle, ComponentType, type APIAllowedMentions } from "discord-api-types/v10";
import { describe, expect, test } from "vitest";
import {
  decodeDiscordActionCustomId,
  encodeDiscordActionCustomId,
  encodeDiscordSendAction,
} from "../../src/conversions/actions";
import { DiscordSendActionError } from "../../src/errors";
import { createMemoryDiscordActionStore } from "../../src/stores/action-store";

const defaults: { readonly allowedMentions: APIAllowedMentions } = {
  allowedMentions: { parse: [], replied_user: false },
};

describe("Discord action conversion", () => {
  test("action button encodes to a Discord button component and round-trips custom id", async () => {
    const encoded = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Deploy?",
        buttons: [
          [
            {
              id: "approve",
              label: "Approve",
              actionId: "deployment",
              value: "approve",
              payload: { deploymentId: "build-123" },
              style: "success",
              disabled: true,
            },
          ],
        ],
        adapterOptions: {},
      },
      defaults,
    );

    expect(encoded.isOk()).toBe(true);
    if (encoded.isErr()) throw encoded.error;

    const payload = encoded.value.payload as { readonly components?: unknown[] };
    const row = payload.components?.[0] as {
      readonly type: number;
      readonly components: readonly [
        { readonly style: number; readonly custom_id: string; readonly disabled: boolean },
      ];
    };
    expect(row.type).toBe(ComponentType.ActionRow);
    expect(row.components[0]).toMatchObject({ style: ButtonStyle.Success, disabled: true });

    const decoded = await decodeDiscordActionCustomId({ customId: row.components[0].custom_id });
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value).toEqual({
        actionId: "deployment",
        value: "approve",
        payload: { deploymentId: "build-123" },
      });
    }
  });

  test("URL button encodes to a Discord link button", async () => {
    const encoded = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Docs",
        buttons: [[{ kind: "url", id: "docs", label: "Docs", url: "https://example.com" }]],
        adapterOptions: {},
      },
      defaults,
    );

    expect(encoded.isOk()).toBe(true);
    if (encoded.isErr()) throw encoded.error;

    const payload = encoded.value.payload as { readonly components?: unknown[] };
    const row = payload.components?.[0] as {
      readonly components: readonly [{ readonly style: number; readonly url: string }];
    };
    expect(row.components[0]).toMatchObject({
      style: ButtonStyle.Link,
      url: "https://example.com",
    });
  });

  test("button row and total limits fail with typed errors", async () => {
    const tooManyRows = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Too many",
        buttons: Array.from({ length: 6 }, (_, index) => [
          { id: `b${index}`, label: "Button", actionId: "a", value: "v" },
        ]),
        adapterOptions: {},
      },
      defaults,
    );

    expect(tooManyRows.isErr()).toBe(true);
    if (tooManyRows.isErr()) expect(tooManyRows.error).toBeInstanceOf(DiscordSendActionError);

    const tooManyButtons = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Too many",
        buttons: [
          [0, 1, 2, 3, 4, 5].map((index) => ({
            id: `b${index}`,
            label: "Button",
            actionId: "a",
            value: "v",
          })),
        ],
        adapterOptions: {},
      },
      defaults,
    );

    expect(tooManyButtons.isErr()).toBe(true);
  });

  test("label and URL limits fail with typed errors", async () => {
    const badLabel = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Bad",
        buttons: [[{ id: "b", label: "", actionId: "a", value: "v" }]],
        adapterOptions: {},
      },
      defaults,
    );
    expect(badLabel.isErr()).toBe(true);

    const badUrl = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Bad",
        buttons: [[{ kind: "url", id: "u", label: "URL", url: "x".repeat(513) }]],
        adapterOptions: {},
      },
      defaults,
    );
    expect(badUrl.isErr()).toBe(true);
  });

  test("oversized custom id fails without store and round-trips with store", async () => {
    const envelope = {
      actionId: "deployment",
      value: "approve",
      payload: { data: "x".repeat(200) },
    };

    const withoutStore = await encodeDiscordActionCustomId({ envelope });
    expect(withoutStore.isErr()).toBe(true);

    const store = createMemoryDiscordActionStore();
    const withStore = await encodeDiscordActionCustomId({ envelope, actionStore: store });
    expect(withStore.isOk()).toBe(true);
    if (withStore.isErr()) throw withStore.error;
    expect(withStore.value.startsWith("xmux:k:")).toBe(true);

    const decoded = await decodeDiscordActionCustomId({
      customId: withStore.value,
      actionStore: store,
    });
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) expect(decoded.value).toEqual(envelope);
  });
});
