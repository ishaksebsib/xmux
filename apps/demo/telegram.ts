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
    await event.reply(`Hello ${name}! Try /echo --text "hello from xmux"`, { mode: "quote" });
  });

  chat.on("command", "echo", async (event) => {
    if (!isAllowedTelegramActor({ actorId: event.actor?.actorId, allowedUserIds })) {
      await event.reply("This demo bot is restricted to configured Telegram user ids.");
      return;
    }

    await event.reply(event.command.options.text, { mode: "quote" });
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
