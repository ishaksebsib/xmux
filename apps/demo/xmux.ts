import type { ChatLogger } from "@xmux/chat-core";
import { createDiscordAdapter } from "@xmux/chat-adapter-discord";
import { createTelegramAdapter } from "@xmux/chat-adapter-telegram";
import { createInMemoryStore, createXmux } from "@xmux/core";
import { createOpenCodeAdapter } from "@xmux/harness-opencode";
import { createPiAdapter } from "@xmux/harness-pi";
import {
  createTelegramAllowedUsersMiddleware,
  createTypingIndicatorMiddleware,
} from "./middleware";

export async function runXmuxDemo() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required in apps/demo/.env");
  }

  if (!discordToken || !applicationId || !guildId) {
    throw new Error(
      "DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_GUILD_ID are required in apps/demo/.env",
    );
  }

  const logger = createDemoLogger();
  const xmux = createXmux({
    harnesses: {
      opencode: createOpenCodeAdapter({ mode: "embedded" }),
      pi: createPiAdapter(),
    },
    chats: {
      telegram: createTelegramAdapter({
        token,
        mode: { type: "polling", dropPendingUpdates: true },
      }),
      discord: createDiscordAdapter({
        token: discordToken,
        applicationId,
        mode: { type: "gateway", observeMessages: true, observeReactions: true },
        commandRegistration: { scope: { type: "guild", guildId }, strategy: "bulk-overwrite" },
      }),
    },
    config: {
      userName: "xmux",
      defaultWorkingDirectory: process.env.XMUX_WORKDIR ?? process.cwd(),
      deliveryMode: "requester_only",
    },
    store: createInMemoryStore(),
    middleware: [
      createTelegramAllowedUsersMiddleware(process.env.XMUX_ALLOWED_TELEGRAM_USER_IDS),
      createTypingIndicatorMiddleware(),
    ],
    logger,
  });

  const initialized = await xmux.initialize();
  if (initialized.isErr()) {
    logger.error("xmux.demo.initialize.failure", { error: initialized.error });
    return;
  }

  logger.info("xmux.demo.running", { message: "Send /new opencode in Telegram or Discord." });

  const shutdown = async () => {
    logger.info("xmux.demo.shutdown.begin");
    const closed = await xmux.shutdown();
    if (closed.isErr()) {
      logger.error("xmux.demo.shutdown.failure", { error: closed.error });
      return;
    }
    logger.info("xmux.demo.shutdown.success");
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit());
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit());
  });
}

function createDemoLogger(): ChatLogger {
  const write = (level: "debug" | "error" | "info" | "trace" | "warn") =>
    ((event: unknown, metadata?: unknown) => {
      const output = metadata === undefined ? [event] : [event, metadata];
      console[level](...output);
    }) satisfies ChatLogger[typeof level];

  return {
    trace: write("trace"),
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  } satisfies ChatLogger;
}
