import { createChat, defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";
import { createTelegramAdapter } from "@xmux/chat-adapter-telegram";

const commands = defineChatCommands({
  start: defineChatCommand({
    description: "Start the Telegram demo bot",
    options: {
      name: stringOption({ required: false }),
    },
  }),
  echo: defineChatCommand({
    description: "Echo text back to Telegram",
    options: {
      text: stringOption({ required: true }),
    },
  }),
  stream: defineChatCommand({
    description: "Stream a demo paragraph to Telegram",
  }),
  stream_reply: defineChatCommand({
    description: "Stream a demo paragraph as a reply",
  }),
});

export async function runTelegramDemo() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required in apps/demo/.env");
  }

  const allowedUserIds = parseAllowedTelegramUserIds(process.env.XMUX_ALLOWED_TELEGRAM_USER_IDS);
  const chat = createChat({
    adapters: {
      telegram: createTelegramAdapter({
        token,
        mode: { type: "polling", dropPendingUpdates: true, allowedUpdates: ["message"] },
      }),
    },
    commands,
  });

  chat.on("diagnostic", (event) => {
    console.log(`[telegram:${event.level}] ${event.code}: ${event.message}`);
  });

  chat.on("error", (event) => {
    console.error("[telegram:error]", event.error);
  });

  chat.on("message", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.message.actor.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    await event.reply(`Received: ${event.message.text}`, { mode: "quote" });
  });

  chat.on("command", "start", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.actor?.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    const name = event.command.options.name ?? "there";
    await event.reply(
      `Hello ${name}! Try /echo --text "hello from xmux", /stream, or /stream_reply`,
      { mode: "quote" },
    );
  });

  chat.on("command", "echo", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.actor?.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    await event.reply(event.command.options.text, { mode: "quote" });
  });

  chat.on("command", "stream", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.actor?.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    await chat.streamMessage({
      chatId: event.chatId,
      conversationId: event.conversation.conversationId,
      content: { chunks: streamDemoParagraph() },
      fallback: "error",
    });
  });

  chat.on("command", "stream_reply", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.actor?.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    await event.replyStream(
      { chunks: streamDemoParagraph() },
      { mode: "quote", fallback: "error" },
    );
  });

  const started = await chat.start();
  if (started.isErr()) {
    throw started.error;
  }

  console.log("Telegram demo bot is running. Press Ctrl+C to stop.");

  const close = async () => {
    const closed = await chat.close();
    if (closed.isErr()) {
      console.error("Failed to close Telegram demo bot", closed.error);
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

async function* streamDemoParagraph() {
  const parts = [
    "Streaming lets xmux show progress while work is still happening. ",
    "This Telegram demo sends a message draft first, then keeps updating it as chunks arrive. ",
    "When the paragraph is complete, grammY persists the final text as a normal Telegram message. ",
    "This is useful for long-running agent responses, summaries, and status updates.",
  ];

  for (const delta of parts) {
    yield { type: "delta" as const, delta };
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

function parseAllowedTelegramUserIds(input: string | undefined): ReadonlySet<string> {
  return new Set(
    input
      ?.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0) ?? [],
  );
}

function isAllowedTelegramActor(args: {
  readonly actorId?: string;
  readonly allowedUserIds: ReadonlySet<string>;
}): boolean {
  return (
    args.allowedUserIds.size === 0 ||
    (args.actorId !== undefined && args.allowedUserIds.has(args.actorId))
  );
}
