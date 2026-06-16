import {
  ChatActionResponseError,
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
  defineChatCommands,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type { CreateSlackBotClient, SlackActionEvent } from "../../src/client";
import { SlackActionResponseError } from "../../src/errors";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { waitForCondition } from "../fixtures/collect";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

const commands = defineChatCommands({});
const actions = defineChatActions({
  deployment: defineChatAction({
    values: {
      approve: actionValue<{ deploymentId: string }>(),
      reject: actionValue<{ deploymentId: string }>(),
    },
  }),
});

describe("Slack action contract", () => {
  test("chat.sendAction sends a message with Block Kit buttons", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const sent = await chat.sendAction({
        chatId: "slack",
        conversationId: "C123",
        text: "Deploy build 123?",
        buttons: [[deploymentButton("approve")]],
        adapterOptions: {},
      });

      expect(sent.isOk()).toBe(true);
      expect(fake.postMessageCalls).toHaveLength(1);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        text: "Deploy build 123?",
        blocks: [
          { type: "section", text: { type: "plain_text", text: "Deploy build 123?" } },
          { type: "actions" },
        ],
      });
    } finally {
      await chat.close();
    }
  });

  test("button click emits typed action event after Slack ack", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);
    const order: string[] = [];
    const seen: string[] = [];

    chat.on("action", "deployment", (event) => {
      order.push("handler");
      seen.push(`${event.value}:${event.payload.deploymentId}`);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      const value = await sendDeploymentActionAndGetValue(chat, fake);
      await fake.emitAction(...slackButtonAction(value), {
        ack: async () => {
          order.push("ack");
        },
      });

      await waitForCondition(() => seen.length === 1);
      expect(order.slice(0, 2)).toEqual(["ack", "handler"]);
      expect(seen).toEqual(["approve:build-123"]);
    } finally {
      await chat.close();
    }
  });

  test("event.ack, event.reply, and event.update map to Slack responses", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);

    chat.on("action", "deployment", async (event) => {
      const acked = await event.ack({ text: "Done", adapterOptions: {} });
      if (acked.isErr()) throw acked.error;
      const replied = await event.reply("Queued", { adapterOptions: {} });
      if (replied.isErr()) throw replied.error;
      const updated = await event.update({
        message: `${event.value} clicked`,
        buttons: [],
        adapterOptions: {},
      });
      if (updated.isErr()) throw updated.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
      );

      await waitForCondition(() => fake.postEphemeralCalls.length === 1);
      await waitForCondition(() => fake.postMessageCalls.length === 2);
      await waitForCondition(() => fake.updateMessageCalls.length === 1);
      expect(fake.postEphemeralCalls[0]).toMatchObject({
        channel: "C123",
        user: "U123",
        thread_ts: "1.000000",
        text: "Done",
      });
      expect(fake.postEphemeralCalls[0]).not.toHaveProperty("mrkdwn");
      expect(fake.postMessageCalls[1]).toMatchObject({
        channel: "C123",
        thread_ts: "1.000000",
        text: "Queued",
      });
      expect(fake.updateMessageCalls[0]).toMatchObject({
        channel: "C123",
        ts: "1.000000",
        text: "approve clicked",
        blocks: [{ type: "section", text: { text: "approve clicked" } }],
      });
      expect(fake.updateMessageCalls[0]).not.toHaveProperty("mrkdwn");
    } finally {
      await chat.close();
    }
  });

  test("ephemeral action replies preserve caller-supplied blocks", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);

    chat.on("action", "deployment", async (event) => {
      const result = await event.reply("Fallback", {
        adapterOptions: {
          ephemeral: true,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Block*" } }],
        },
      });
      if (result.isErr()) throw result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
      );

      await waitForCondition(() => fake.postEphemeralCalls.length === 1);
      expect(fake.postEphemeralCalls[0]).toMatchObject({
        channel: "C123",
        user: "U123",
        thread_ts: "1.000000",
        text: "Fallback",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Block*" } }],
      });
      expect(fake.postEphemeralCalls[0]).not.toHaveProperty("mrkdwn");
    } finally {
      await chat.close();
    }
  });

  test("event.ack with showAlert fails explicitly", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);
    let responseError: unknown;

    chat.on("action", "deployment", async (event) => {
      const result = await event.ack({ text: "Done", showAlert: true, adapterOptions: {} });
      if (result.isErr()) responseError = result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
      );

      await waitForCondition(() => responseError !== undefined);
      expect(responseError).toBeInstanceOf(ChatActionResponseError);
      if (responseError instanceof ChatActionResponseError) {
        expect(responseError.cause).toBeInstanceOf(SlackActionResponseError);
      }
    } finally {
      await chat.close();
    }
  });

  test("event.update rejects conflicting native blocks when buttons are generated", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);
    let responseError: unknown;

    chat.on("action", "deployment", async (event) => {
      const result = await event.update({
        message: "Choose again",
        buttons: [[deploymentButton("reject")]],
        adapterOptions: { blocks: [{ type: "section", text: { type: "mrkdwn", text: "native" } }] },
      });
      if (result.isErr()) responseError = result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
      );

      await waitForCondition(() => responseError !== undefined);
      expect(responseError).toBeInstanceOf(ChatActionResponseError);
      if (responseError instanceof ChatActionResponseError) {
        expect(responseError.cause).toBeInstanceOf(SlackActionResponseError);
      }
      expect(fake.updateMessageCalls).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("retried Slack actions are acked and ignored", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);
    const order: string[] = [];
    const actionsSeen: unknown[] = [];

    chat.on("action", "deployment", (event) => {
      actionsSeen.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
        {
          retryNum: 1,
          retryReason: "timeout",
          ack: async () => {
            order.push("ack");
          },
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(order).toEqual(["ack"]);
      expect(actionsSeen).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("foreign Slack buttons are acked and ignored", async () => {
    const fake = createFakeSlackClient();
    const chat = createSlackChat(fake);
    const order: string[] = [];
    const actionsSeen: unknown[] = [];
    const errorsSeen: unknown[] = [];

    chat.on("action", "deployment", (event) => {
      actionsSeen.push(event);
    });
    chat.on("error", (event) => {
      errorsSeen.push(event.error);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(...slackButtonAction("foreign:value"), {
        ack: async () => {
          order.push("ack-value");
        },
      });
      await fake.emitAction(...slackUrlButtonAction(), {
        ack: async () => {
          order.push("ack-url");
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(order).toEqual(["ack-value", "ack-url"]);
      expect(actionsSeen).toHaveLength(0);
      expect(errorsSeen).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("Slack API failure maps to chat and adapter action response errors", async () => {
    const fake = createFakeSlackClient({ updateMessageError: new Error("update failed") });
    const chat = createSlackChat(fake);
    let responseError: unknown;

    chat.on("action", "deployment", async (event) => {
      const result = await event.update({ message: "failed", adapterOptions: {} });
      if (result.isErr()) responseError = result.error;
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      await fake.emitAction(
        ...slackButtonAction(await sendDeploymentActionAndGetValue(chat, fake)),
      );

      await waitForCondition(() => responseError !== undefined);
      expect(responseError).toBeInstanceOf(ChatActionResponseError);
      if (responseError instanceof ChatActionResponseError) {
        expect(responseError.cause).toBeInstanceOf(SlackActionResponseError);
      }
    } finally {
      await chat.close();
    }
  });
});

function createSlackChat(fake: ReturnType<typeof createFakeSlackClient>) {
  return createChat({
    adapters: { slack: createTestAdapter(fake) },
    commands,
    actions,
  });
}

function createTestAdapter(fake: ReturnType<typeof createFakeSlackClient>) {
  return createSlackAdapter<"slack">({
    ...socketOptions(),
    createClient: (() => fake) satisfies CreateSlackBotClient,
  });
}

function socketOptions(): CreateSlackAdapterOptions<"slack"> {
  return {
    botToken: "xoxb-token",
    mode: { type: "socket", appToken: "xapp-token" },
  };
}

function deploymentButton(value: "approve" | "reject") {
  return {
    id: value,
    label: value === "approve" ? "Approve" : "Reject",
    actionId: "deployment",
    value,
    payload: { deploymentId: "build-123" },
    style: value === "approve" ? "success" : "danger",
  } as const;
}

async function sendDeploymentActionAndGetValue(
  chat: ReturnType<typeof createSlackChat>,
  fake: ReturnType<typeof createFakeSlackClient>,
): Promise<string> {
  const sent = await chat.sendAction({
    chatId: "slack",
    conversationId: "C123",
    text: "Deploy build 123?",
    buttons: [[deploymentButton("approve")]],
    adapterOptions: {},
  });
  if (sent.isErr()) throw sent.error;

  const value = (
    fake.postMessageCalls.at(-1)?.blocks as
      | readonly [{}, { readonly elements: readonly [{ readonly value?: string }] }]
      | undefined
  )?.[1]?.elements[0]?.value;
  if (value === undefined) throw new Error("Missing Slack button value");
  return value;
}

function slackButtonAction(value: string): [SlackActionEvent["action"], SlackActionEvent["body"]] {
  const action = {
    type: "button",
    block_id: "xmux_actions_1",
    action_id: "xmux_approve",
    action_ts: "172.000000",
    value,
    text: { type: "plain_text", text: "Approve" },
  };
  return slackActionPayload(action);
}

function slackUrlButtonAction(): [SlackActionEvent["action"], SlackActionEvent["body"]] {
  const action = {
    type: "button",
    block_id: "xmux_actions_1",
    action_id: "xmux_docs",
    action_ts: "173.000000",
    url: "https://example.com/docs",
    text: { type: "plain_text", text: "Docs" },
  };
  return slackActionPayload(action);
}

function slackActionPayload(
  action: Record<string, unknown>,
): [SlackActionEvent["action"], SlackActionEvent["body"]] {
  const body = {
    type: "block_actions",
    team: { id: "T123", domain: "test" },
    user: { id: "U123", username: "riley" },
    channel: { id: "C123", name: "general" },
    message: { type: "message", ts: "1.000000", text: "Deploy build 123?" },
    response_url: "https://hooks.slack.test/actions/1",
    trigger_id: "TRIGGER123",
    actions: [action],
    token: "token",
    api_app_id: "A123",
    container: { type: "message", channel_id: "C123", message_ts: "1.000000" },
  };

  return [action as never, body as never];
}
