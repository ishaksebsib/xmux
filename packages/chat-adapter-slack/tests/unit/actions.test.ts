import { describe, expect, test } from "vitest";
import {
  decodeSlackActionValue,
  encodeSlackActionValue,
  encodeSlackSendAction,
} from "../../src/conversions/actions";
import { SlackSendActionError } from "../../src/errors";
import { createMemorySlackActionStore } from "../../src/stores/action-store";

describe("Slack action conversion", () => {
  test("action button encodes to Block Kit and round-trips button value", async () => {
    const result = await encodeSlackSendAction(
      {
        chatId: "slack",
        conversationId: "C123",
        text: "Deploy build 123?",
        format: "markdown",
        buttons: [
          [
            {
              id: "approve",
              label: "Approve",
              actionId: "deployment",
              value: "approve",
              payload: { deploymentId: "build-123" },
              style: "success",
            },
            { kind: "url", id: "docs", label: "Docs", url: "https://example.com/docs" },
          ],
        ],
        adapterOptions: {},
      },
      {},
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.channel).toBe("C123");
    expect(result.value.text).toBe("Deploy build 123?");
    expect(result.value.blocks).toMatchObject([
      { type: "section", text: { type: "mrkdwn", text: "Deploy build 123?" } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "xmux_approve",
            text: { text: "Approve" },
            style: "primary",
          },
          {
            type: "button",
            action_id: "xmux_docs",
            text: { text: "Docs" },
            url: "https://example.com/docs",
          },
        ],
      },
    ]);

    const value = actionButtonValue(result.value.blocks);
    const decoded = await decodeSlackActionValue({ value });
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value).toEqual({
        actionId: "deployment",
        value: "approve",
        payload: { deploymentId: "build-123" },
      });
    }
  });

  test("oversized button values use an action store when configured", async () => {
    const store = createMemorySlackActionStore();
    const envelope = {
      actionId: "deployment",
      value: "approve",
      payload: { text: "x".repeat(3_000) },
    };

    const withoutStore = await encodeSlackActionValue({ envelope });
    expect(withoutStore.isErr()).toBe(true);
    if (withoutStore.isErr()) {
      expect(withoutStore.error).toBeInstanceOf(SlackSendActionError);
    }

    const withStore = await encodeSlackActionValue({ envelope, actionStore: store });
    expect(withStore.isOk()).toBe(true);
    if (withStore.isErr()) return;

    const decoded = await decodeSlackActionValue({ value: withStore.value, actionStore: store });
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value).toEqual(envelope);
    }
  });

  test("sendAction rejects caller-supplied native blocks", async () => {
    const result = await encodeSlackSendAction(
      {
        chatId: "slack",
        conversationId: "C123",
        text: "Pick",
        buttons: [[{ id: "b", label: "Button", actionId: "choice", value: "ok" }]],
        adapterOptions: { blocks: [{ type: "section", text: { type: "mrkdwn", text: "native" } }] },
      },
      {},
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("adapterOptions.blocks");
    }
  });

  test("button layout and unsupported disabled buttons fail with typed errors", async () => {
    const empty = await encodeSlackSendAction(
      {
        chatId: "slack",
        conversationId: "C123",
        text: "Pick",
        buttons: [],
        adapterOptions: {},
      },
      {},
    );
    expect(empty.isErr()).toBe(true);

    const tooManyInRow = await encodeSlackSendAction(
      {
        chatId: "slack",
        conversationId: "C123",
        text: "Pick",
        buttons: [
          Array.from({ length: 6 }, (_, index) => ({
            id: `b${index}`,
            label: "Button",
            actionId: "choice",
            value: "ok",
          })),
        ],
        adapterOptions: {},
      },
      {},
    );
    expect(tooManyInRow.isErr()).toBe(true);

    const disabled = await encodeSlackSendAction(
      {
        chatId: "slack",
        conversationId: "C123",
        text: "Pick",
        buttons: [[{ id: "b", label: "Button", actionId: "choice", value: "ok", disabled: true }]],
        adapterOptions: {},
      },
      {},
    );
    expect(disabled.isErr()).toBe(true);
    if (disabled.isErr()) {
      expect(disabled.error.message).toContain("disabled");
    }
  });
});

function actionButtonValue(blocks: unknown): string {
  const value = (
    blocks as readonly [{}, { readonly elements: readonly [{ readonly value: string }] }]
  )[1]?.elements[0]?.value;
  if (value === undefined) throw new Error("Missing encoded Slack action value");
  return value;
}
