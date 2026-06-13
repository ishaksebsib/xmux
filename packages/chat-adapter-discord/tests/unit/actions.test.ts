import { ButtonStyle, ComponentType, type APIAllowedMentions } from "discord-api-types/v10";
import { describe, expect, test } from "vitest";
import {
  decodeDiscordActionCustomId,
  encodeDiscordActionCustomId,
  encodeDiscordActionResponse,
  encodeDiscordSendAction,
} from "../../src/conversions/actions";
import { DiscordActionResponseError, DiscordSendActionError } from "../../src/errors";
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

  test("empty sendAction components and rows fail with typed errors", async () => {
    const emptyComponents = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Empty",
        buttons: [],
        adapterOptions: {},
      },
      defaults,
    );
    expect(emptyComponents.isErr()).toBe(true);
    if (emptyComponents.isErr())
      expect(emptyComponents.error).toBeInstanceOf(DiscordSendActionError);

    const emptyRow = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Empty",
        buttons: [[]],
        adapterOptions: {},
      },
      defaults,
    );
    expect(emptyRow.isErr()).toBe(true);
  });

  test("update allows clearing components but rejects empty rows", async () => {
    const clear = await encodeDiscordActionResponse(
      {
        chatId: "discord",
        conversationId: "channel-1",
        interactionId: "interaction-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
        response: { kind: "update", buttons: [] },
        adapterOptions: {},
      },
      defaults,
    );
    expect(clear.isOk()).toBe(true);
    if (clear.isOk() && clear.value.kind === "update") {
      expect(clear.value.edit.components).toEqual([]);
    }

    const emptyRow = await encodeDiscordActionResponse(
      {
        chatId: "discord",
        conversationId: "channel-1",
        interactionId: "interaction-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
        response: { kind: "update", buttons: [[]] },
        adapterOptions: {},
      },
      defaults,
    );
    expect(emptyRow.isErr()).toBe(true);
    if (emptyRow.isErr()) expect(emptyRow.error).toBeInstanceOf(DiscordActionResponseError);
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

  test("URL buttons require valid http(s) URLs", async () => {
    for (const url of ["not a url", "ftp://example.com/file", "mailto:a@example.com"]) {
      const encoded = await encodeDiscordSendAction(
        {
          chatId: "discord",
          conversationId: "channel-1",
          text: "Bad URL",
          buttons: [[{ kind: "url", id: "u", label: "URL", url }]],
          adapterOptions: {},
        },
        defaults,
      );
      expect(encoded.isErr()).toBe(true);
    }
  });

  test("action button actionId and value must not be empty", async () => {
    const emptyActionId = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Bad",
        buttons: [[{ id: "b", label: "Button", actionId: " ", value: "value" }]],
        adapterOptions: {},
      },
      defaults,
    );
    expect(emptyActionId.isErr()).toBe(true);

    const emptyValue = await encodeDiscordSendAction(
      {
        chatId: "discord",
        conversationId: "channel-1",
        text: "Bad",
        buttons: [[{ id: "b", label: "Button", actionId: "action", value: "" }]],
        adapterOptions: {},
      },
      defaults,
    );
    expect(emptyValue.isErr()).toBe(true);
  });

  test("ack showAlert fails explicitly", async () => {
    const encoded = await encodeDiscordActionResponse(
      {
        chatId: "discord",
        conversationId: "channel-1",
        interactionId: "interaction-1",
        message: { chatId: "discord", conversationId: "channel-1", messageId: "message-1" },
        response: { kind: "ack", text: "Done", showAlert: true },
        adapterOptions: {},
      },
      defaults,
    );

    expect(encoded.isErr()).toBe(true);
    if (encoded.isErr()) expect(encoded.error).toBeInstanceOf(DiscordActionResponseError);
  });

  test("memory action store expires entries by default TTL", async () => {
    const store = createMemoryDiscordActionStore({ defaultTtlMs: 1 });
    await store.set("key", { actionId: "deployment", value: "approve" });
    expect(await store.get("key")).toEqual({ actionId: "deployment", value: "approve" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await store.get("key")).toBeUndefined();
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
