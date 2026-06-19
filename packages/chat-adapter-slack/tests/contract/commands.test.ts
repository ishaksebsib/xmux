import {
  booleanOption,
  createChat,
  defineChatCommand,
  defineChatCommands,
  stringOption,
  type ChatEventByType,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackAdapter } from "../../src";
import type {
  CreateSlackBotClient,
  SlackAppMentionEvent,
  SlackCommandEvent,
  SlackMessageEvent,
} from "../../src/client";
import type { CreateSlackAdapterOptions } from "../../src/types";
import { waitForCondition } from "../fixtures/collect";
import { createFakeSlackClient } from "../fixtures/fake-slack-client";

const commands = defineChatCommands({
  deploy: defineChatCommand({
    description: "Deploy a service",
    options: {
      service: stringOption({ required: true }),
      dryRun: booleanOption(),
    },
  }),
});

type SlackCommandEventForTest = ChatEventByType<
  "command",
  typeof commands,
  Record<never, never>,
  "slack"
>;
type SlackInvalidCommandEventForTest = ChatEventByType<
  "command.invalid",
  typeof commands,
  Record<never, never>,
  "slack"
>;
type SlackUnknownCommandEventForTest = ChatEventByType<
  "command.unknown",
  typeof commands,
  Record<never, never>,
  "slack"
>;

describe("Slack slash command contract", () => {
  test("acks before emitting a parsed direct command event", async () => {
    const fake = createFakeSlackClient();
    const order: string[] = [];
    const events: SlackCommandEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("command", (event) => {
      order.push("handler");
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitCommand(slashCommand({ command: "/deploy", text: "--service api --dryRun" }), {
        ack: async () => {
          order.push("ack");
        },
      });

      await waitForCondition(() => events.length === 1);
      expect(order).toEqual(["ack", "handler"]);
      expect(events[0]?.command).toEqual({
        name: "deploy",
        options: { service: "api", dryRun: true },
      });
      expect(events[0]?.conversation).toEqual({ chatId: "slack", conversationId: "C123" });
      expect(events[0]?.actor).toMatchObject({
        kind: "user",
        actorId: "U123",
        displayName: "riley",
        adapterData: {
          slackTeamId: "T123",
          slackChannelId: "C123",
          slackUserId: "U123",
        },
      });
    } finally {
      await chat.close();
    }
  });

  test("acks and ignores retried slash commands", async () => {
    const fake = createFakeSlackClient();
    const order: string[] = [];
    const events: SlackCommandEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("command", (event) => {
      order.push("handler");
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitCommand(slashCommand({ command: "/deploy", text: "--service api" }), {
        retryNum: 1,
        retryReason: "timeout",
        ack: async () => {
          order.push("ack");
        },
      });

      expect(order).toEqual(["ack"]);
      expect(events).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("app mention commands are disabled by default", async () => {
    const fake = createFakeSlackClient();
    const events: SlackCommandEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("command", (event) => {
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      expect(fake.handlerCountsAtStart[0]?.appMention).toBe(0);

      await fake.emitAppMention(appMention({ text: "<@U_BOT> deploy --service api" }));
      expect(events).toHaveLength(0);
    } finally {
      await chat.close();
    }
  });

  test("enabled app mention commands emit parsed command events with message context", async () => {
    const fake = createFakeSlackClient();
    const events: SlackCommandEventForTest[] = [];
    const chat = createTestChat(fake, { mentionCommands: { enabled: true } });

    chat.on("command", (event) => {
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);
      expect(fake.handlerCountsAtStart[0]?.appMention).toBe(1);

      await fake.emitAppMention(appMention({ text: "<@U_BOT> deploy --service api --dryRun" }));

      await waitForCondition(() => events.length === 1);
      expect(events[0]).toMatchObject({
        type: "command",
        chatId: "slack",
        conversation: { chatId: "slack", conversationId: "C123" },
        message: { chatId: "slack", conversationId: "C123", messageId: "171.000100" },
        command: { name: "deploy", options: { service: "api", dryRun: true } },
      });
      expect(events[0]?.actor).toMatchObject({
        kind: "user",
        actorId: "U123",
        adapterData: {
          slackTeamId: "T123",
          slackChannelId: "C123",
          slackUserId: "U123",
          slackThreadTs: "171.000100",
        },
      });
    } finally {
      await chat.close();
    }
  });

  test("enabled mention commands parse observed Slack message events", async () => {
    const fake = createFakeSlackClient();
    const events: SlackCommandEventForTest[] = [];
    const chat = createTestChat(fake, { mentionCommands: { enabled: true } });

    chat.on("command", (event) => {
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitMessage(message({ text: "<@U_BOT> /deploy --service api" }));

      await waitForCondition(() => events.length === 1);
      expect(events[0]).toMatchObject({
        type: "command",
        command: { name: "deploy", options: { service: "api", dryRun: undefined } },
        message: { chatId: "slack", conversationId: "C123", messageId: "171.000100" },
      });
    } finally {
      await chat.close();
    }
  });

  test("enabled mention command replies use the source Slack thread", async () => {
    const fake = createFakeSlackClient();
    const replies: boolean[] = [];
    const chat = createTestChat(fake, { mentionCommands: { enabled: true } });

    chat.on("command", "deploy", async (event) => {
      const result = await event.reply("resumed");
      replies.push(result.isOk());
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitMessage(
        message({ text: "<@U_BOT> deploy --service api", thread_ts: "171.000001" }),
      );

      await waitForCondition(() => replies.length === 1);
      expect(replies).toEqual([true]);
      expect(fake.postMessageCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000001",
        text: "resumed",
      });
    } finally {
      await chat.close();
    }
  });

  test("enabled app mention command replies stream natively in the source Slack thread", async () => {
    const fake = createFakeSlackClient();
    const results: boolean[] = [];
    const chat = createTestChat(fake, {
      mentionCommands: { enabled: true },
      stream: { bufferSize: 2 },
    });

    chat.on("command", "deploy", async (event) => {
      const result = await event.replyStream(
        { chunks: oneDelta("ok"), format: "markdown" },
        { fallback: "error" },
      );
      results.push(result.isOk());
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitAppMention(
        appMention({ text: "<@U_BOT> deploy --service api", thread_ts: "171.000001" }),
      );

      await waitForCondition(() => results.length === 1);
      expect(results).toEqual([true]);
      expect(fake.startStreamCalls[0]).toMatchObject({
        channel: "C123",
        thread_ts: "171.000001",
        recipient_team_id: "T123",
        recipient_user_id: "U123",
        chunks: [{ type: "markdown_text", text: "ok" }],
      });
    } finally {
      await chat.close();
    }
  });

  test("root mode emits command.unknown for unknown subcommands", async () => {
    const fake = createFakeSlackClient();
    const events: SlackUnknownCommandEventForTest[] = [];
    const chat = createTestChat(fake, { commandMode: { type: "root", command: "/xmux" } });

    chat.on("command.unknown", (event) => {
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitCommand(slashCommand({ command: "/xmux", text: "missing --name value" }));

      await waitForCondition(() => events.length === 1);
      expect(events[0]).toMatchObject({
        type: "command.unknown",
        chatId: "slack",
        commandName: "missing",
        conversation: { chatId: "slack", conversationId: "C123" },
      });
    } finally {
      await chat.close();
    }
  });

  test("invalid command options emit command.invalid", async () => {
    const fake = createFakeSlackClient();
    const events: SlackInvalidCommandEventForTest[] = [];
    const chat = createTestChat(fake);

    chat.on("command.invalid", (event) => {
      events.push(event);
    });

    try {
      expect((await chat.start()).isOk()).toBe(true);

      await fake.emitCommand(slashCommand({ command: "/deploy", text: "--dryRun" }));

      await waitForCondition(() => events.length === 1);
      expect(events[0]).toMatchObject({
        type: "command.invalid",
        chatId: "slack",
        commandName: "deploy",
        optionName: "service",
        reason: "required option is missing",
      });
    } finally {
      await chat.close();
    }
  });
});

function createTestChat(
  fake: ReturnType<typeof createFakeSlackClient>,
  options: Partial<CreateSlackAdapterOptions<"slack">> = {},
) {
  return createChat({
    adapters: { slack: createTestAdapter(fake, options) },
    commands,
  });
}

function createTestAdapter(
  fake: ReturnType<typeof createFakeSlackClient>,
  options: Partial<CreateSlackAdapterOptions<"slack">> = {},
) {
  return createSlackAdapter<"slack">({
    ...socketOptions(),
    ...options,
    createClient: (() => fake) satisfies CreateSlackBotClient,
  });
}

function socketOptions(): CreateSlackAdapterOptions<"slack"> {
  return {
    botToken: "xoxb-token",
    mode: { type: "socket", appToken: "xapp-token" },
  };
}

function appMention(
  overrides: Partial<{
    readonly text: string;
    readonly thread_ts: string;
  }> = {},
): SlackAppMentionEvent["event"] {
  return {
    type: "app_mention",
    channel: "C123",
    ts: "171.000100",
    text: "<@U_BOT> deploy --service api",
    user: "U123",
    username: "riley",
    team: "T123",
    ...overrides,
  } as never;
}

function message(
  overrides: Partial<{
    readonly text: string;
    readonly thread_ts: string;
  }> = {},
): SlackMessageEvent["event"] {
  return {
    type: "message",
    channel: "C123",
    ts: "171.000100",
    text: "<@U_BOT> deploy --service api",
    user: "U123",
    username: "riley",
    team: "T123",
    ...overrides,
  } as never;
}

async function* oneDelta(delta: string) {
  yield { type: "delta" as const, delta };
}

function slashCommand(args: {
  readonly command: string;
  readonly text: string;
}): SlackCommandEvent["payload"] {
  return {
    token: "legacy-token",
    command: args.command,
    text: args.text,
    response_url: "https://hooks.slack.test/commands/1",
    trigger_id: `trigger-${args.command}-${args.text}`,
    user_id: "U123",
    user_name: "riley",
    team_id: "T123",
    team_domain: "example",
    channel_id: "C123",
    channel_name: "general",
    api_app_id: "A123",
  };
}
