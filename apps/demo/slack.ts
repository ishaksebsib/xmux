import "dotenv/config";
import {
  actionValue,
  createChat,
  defineChatAction,
  defineChatActions,
  defineChatCommand,
  defineChatCommands,
  stringOption,
  type ChatActor,
} from "@xmux/chat-core";
import { createSlackAdapter, type SlackAdapterOptions } from "@xmux/chat-adapter-slack";
import type { InferOk, Result } from "better-result";

const attachmentReadMaxBytes = 1_000_000;

const commands = defineChatCommands({
  echo: defineChatCommand({
    description: "Echo text back to Slack",
    options: {
      text: stringOption({ description: "Text to echo", required: true }),
    },
  }),
  actions: defineChatCommand({
    description: "Send a Slack Block Kit action demo",
  }),
  stream: defineChatCommand({
    description: "Post a parent message, then stream a native Slack message in its thread",
  }),
  stream_reply: defineChatCommand({
    description: "Post a parent message, then stream a native Slack reply to it",
  }),
});

const actions = defineChatActions({
  slack_demo: defineChatAction({
    description: "Slack demo approve/reject action",
    values: {
      approve: actionValue<{ readonly requestId: string }>(),
      reject: actionValue<{ readonly requestId: string }>(),
    },
  }),
});

interface SlackDemoEnv {
  readonly botToken: string;
  readonly appToken: string;
  readonly testChannelId: string;
  readonly allowedUserIds: ReadonlySet<string>;
  readonly streamRecipientTeamId?: string;
  readonly streamRecipientUserId?: string;
}

export async function runSlackDemo() {
  const env = readSlackDemoEnv();
  const chat = createChat({
    adapters: {
      slack: createSlackAdapter({
        botToken: env.botToken,
        mode: { type: "socket", appToken: env.appToken },
        commandMode: { type: "root", command: "/xmux" },
      }),
    },
    commands,
    actions,
  });

  chat.on("error", (event) => {
    console.error("[slack:error]", event.error);
  });

  chat.on("command.invalid", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    await ensureOk(
      event.reply(`Invalid /xmux ${event.commandName}: ${event.reason}`, { mode: "conversation" }),
    );
  });

  chat.on("command.unknown", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    await ensureOk(
      event.reply(
        `Unknown /xmux command "${event.commandName}". Try \`/xmux echo --text "hi"\`, \`/xmux actions\`, \`/xmux stream\`, or \`/xmux stream_reply\`.`,
        { mode: "conversation" },
      ),
    );
  });

  chat.on("command", "echo", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    await ensureOk(event.reply(event.command.options.text, { mode: "conversation" }));
  });

  chat.on("command", "actions", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    const requestId = `demo-${Date.now()}`;
    const sent = await chat.sendAction({
      chatId: event.chatId,
      conversationId: event.conversation.conversationId,
      text: `Slack action demo ${requestId}: approve or reject?`,
      buttons: [
        [
          {
            id: "approve",
            label: "Approve",
            actionId: "slack_demo",
            value: "approve",
            payload: { requestId },
            style: "primary",
          },
          {
            id: "reject",
            label: "Reject",
            actionId: "slack_demo",
            value: "reject",
            payload: { requestId },
            style: "danger",
          },
          {
            kind: "url",
            id: "docs",
            label: "xmux",
            url: "https://github.com/ishaksebsib/xmux",
          },
        ],
      ],
    });

    await ensureOk(sent);
  });

  chat.on("command", "stream", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    const parent = await ensureOk(
      chat.sendMessage({
        chatId: event.chatId,
        conversationId: event.conversation.conversationId,
        text: "Starting a Slack native stream in this thread…",
      }),
    );
    const streamed = await chat.streamMessage({
      chatId: event.chatId,
      conversationId: event.conversation.conversationId,
      content: { chunks: streamDemoParagraph(), format: "markdown" },
      fallback: "error",
      adapterOptions: streamAdapterOptions({
        env,
        threadTs: parent.messageId,
        actor: event.actor,
      }),
    });

    if (streamed.isErr()) {
      console.error("[slack:stream:error]", streamed.error);
      await ensureOk(event.reply(`Slack stream failed: ${describeError(streamed.error)}`));
    }
  });

  chat.on("command", "stream_reply", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.reply(restrictedMessage()));
      return;
    }

    const parent = await ensureOk(
      chat.sendMessage({
        chatId: event.chatId,
        conversationId: event.conversation.conversationId,
        text: "Starting a Slack native stream reply to this message…",
      }),
    );
    const streamed = await chat.streamReply({
      chatId: event.chatId,
      conversationId: event.conversation.conversationId,
      messageId: parent.messageId,
      mode: "thread",
      content: { chunks: streamDemoParagraph(), format: "markdown" },
      fallback: "error",
      adapterOptions: streamAdapterOptions({
        env,
        threadTs: parent.messageId,
        actor: event.actor,
      }),
    });

    if (streamed.isErr()) {
      console.error("[slack:stream_reply:error]", streamed.error);
      await ensureOk(event.reply(`Slack stream reply failed: ${describeError(streamed.error)}`));
    }
  });

  chat.on("action", "slack_demo", async (event) => {
    if (
      !isAllowedSlackActor({ actorId: event.actor?.actorId, allowedUserIds: env.allowedUserIds })
    ) {
      await ensureOk(event.ack({ text: restrictedMessage() }));
      return;
    }

    const requestId = event.payload.requestId;
    await ensureOk(event.ack({ text: `${event.value} received for ${requestId}` }));
    await ensureOk(event.reply(`Queued ${event.value} for ${requestId}`));
    await ensureOk(
      event.update({
        message: `Slack action demo ${requestId}: **${event.value}** selected.`,
        buttons: [],
      }),
    );
  });

  chat.on("message", async (event) => {
    if (
      !isAllowedSlackActor({
        actorId: event.message.actor.actorId,
        allowedUserIds: env.allowedUserIds,
      })
    ) {
      await ensureOk(event.reply(restrictedMessage(), { mode: "quote" }));
      return;
    }

    for (const attachment of event.message.attachments) {
      const opened = await attachment.open({ maxBytes: attachmentReadMaxBytes });
      if (opened.isErr()) {
        console.error("[slack:attachment:error]", attachment.attachmentId, opened.error);
        continue;
      }

      const sizeBytes = await countBytes(opened.value.chunks);
      console.log("[slack:attachment]", {
        id: attachment.attachmentId,
        filename: attachment.filename,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        sizeBytes,
      });
    }

    const attachmentSummary =
      event.message.attachments.length === 0
        ? ""
        : ` with ${event.message.attachments.length} attachment(s)`;
    await ensureOk(
      event.reply(`Received${attachmentSummary}: ${event.message.text || "(no text)"}`, {
        mode: "quote",
      }),
    );
  });

  chat.on("reaction.added", (event) => {
    console.log("[slack:reaction.added]", event.reaction, event.message.messageId, event.actor);
  });

  chat.on("reaction.removed", (event) => {
    console.log("[slack:reaction.removed]", event.reaction, event.message.messageId, event.actor);
  });

  const started = await chat.start();
  await ensureOk(started);

  try {
    const announced = await chat.sendMessage({
      chatId: "slack",
      conversationId: env.testChannelId,
      text: '*xmux Slack demo is running.* Try `/xmux echo --text "hello"`, `/xmux actions`, `/xmux stream`, or `/xmux stream_reply`.',
      format: "markdown",
    });
    const sent = await ensureOk(announced);
    console.log("Slack demo startup message sent:", sent.messageId);
  } catch (error) {
    await chat.close();
    throw error;
  }

  console.log("Slack demo bot is running. Press Ctrl+C to stop.");

  const close = async () => {
    const closed = await chat.close();
    if (closed.isErr()) {
      console.error("Failed to close Slack demo bot", closed.error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit());
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit());
  });
}

function readSlackDemoEnv(): SlackDemoEnv {
  const streamRecipientTeamId = nonEmpty(process.env.SLACK_STREAM_RECIPIENT_TEAM_ID);
  const streamRecipientUserId = nonEmpty(process.env.SLACK_STREAM_RECIPIENT_USER_ID);

  return {
    botToken: requireEnv("SLACK_BOT_TOKEN"),
    appToken: requireEnv("SLACK_APP_TOKEN"),
    testChannelId: requireEnv("SLACK_TEST_CHANNEL_ID"),
    allowedUserIds: parseCsvSet(process.env.XMUX_ALLOWED_SLACK_USER_IDS),
    ...(streamRecipientTeamId === undefined ? {} : { streamRecipientTeamId }),
    ...(streamRecipientUserId === undefined ? {} : { streamRecipientUserId }),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required in apps/demo/.env`);
  }
  return value;
}

function parseCsvSet(input: string | undefined): ReadonlySet<string> {
  return new Set(
    input
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? [],
  );
}

function isAllowedSlackActor(args: {
  readonly actorId?: string;
  readonly allowedUserIds: ReadonlySet<string>;
}): boolean {
  return (
    args.allowedUserIds.size === 0 ||
    (args.actorId !== undefined && args.allowedUserIds.has(args.actorId))
  );
}

function restrictedMessage(): string {
  return "This demo bot is restricted to configured Slack user ids.";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function streamAdapterOptions(args: {
  readonly env: SlackDemoEnv;
  readonly threadTs: string;
  readonly actor?: ChatActor;
}): SlackAdapterOptions {
  const recipientUserId = nonEmpty(args.actor?.actorId) ?? args.env.streamRecipientUserId;
  const recipientTeamId = readSlackTeamId(args.actor) ?? args.env.streamRecipientTeamId;

  return {
    stream: {
      threadTs: args.threadTs,
      ...(recipientUserId === undefined ? {} : { recipientUserId }),
      ...(recipientTeamId === undefined ? {} : { recipientTeamId }),
    },
  };
}

function readSlackTeamId(actor: { readonly adapterData: unknown } | undefined): string | undefined {
  const adapterData = actor?.adapterData;
  if (!isRecord(adapterData)) return undefined;

  const value = adapterData["slackTeamId"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

async function ensureOk<TResult extends Result<unknown, unknown>>(
  result: TResult | Promise<TResult>,
): Promise<InferOk<TResult>> {
  const resolved = await result;
  return resolved.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  }) as InferOk<TResult>;
}

async function countBytes(chunks: AsyncIterable<Uint8Array>): Promise<number> {
  let sizeBytes = 0;
  for await (const chunk of chunks) {
    sizeBytes += chunk.byteLength;
  }
  return sizeBytes;
}

async function* streamDemoParagraph() {
  const parts = [
    "# Slack native streaming demo\n\n",
    "xmux is sending this through Slack `chat.startStream`, `chat.appendStream`, and `chat.stopStream`. ",
    "The adapter buffers chunks, respects Slack markdown_text limits, and finalizes the native stream cleanly. ",
    "Use this path for long-running agent responses and progress updates.",
  ];

  for (const delta of parts) {
    yield { type: "delta" as const, delta };
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}
