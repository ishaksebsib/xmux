import { createTelegramAdapter } from "@xmux/chat-adapter-telegram";
import { createInMemoryStore, createXmux } from "@xmux/core";
import { createOpenCodeAdapter } from "@xmux/harness-opencode";
import { createTelegramAllowedUsersMiddleware } from "./middleware";

export async function runXmuxDemo() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required in apps/demo/.env");
  }

  const xmux = createXmux({
    harnesses: {
      opencode: createOpenCodeAdapter({ mode: "embedded" }),
    },
    chats: {
      telegram: createTelegramAdapter({
        token,
        mode: { type: "polling", dropPendingUpdates: true, allowedUpdates: ["message"] },
      }),
    },
    config: {
      userName: "xmux",
      defaultWorkingDirectory: process.env.XMUX_WORKDIR ?? process.cwd(),
      deliveryMode: "requester_only",
    },
    store: createInMemoryStore(),
    middleware: [createTelegramAllowedUsersMiddleware(process.env.XMUX_ALLOWED_TELEGRAM_USER_IDS)],
  });

  xmux.ctx.chat.on("ready", (event) => {
    console.log(`[xmux] chat ready: ${event.chatId}`);
  });

  xmux.ctx.chat.on("diagnostic", (event) => {
    console.log(`[xmux:${event.level}] ${event.code}: ${event.message}`);
  });

  xmux.ctx.chat.on("message", (event) => {
    console.log(`[xmux] received message: ${event.message.text}`);
  });

  xmux.ctx.chat.on("command", "new", (event) => {
    console.log(`[xmux] received /new ${event.command.options.harnessId}`);
  });

  xmux.ctx.chat.on("error", (event) => {
    console.error("[xmux] chat error", event.error);
  });

  const initialized = await xmux.initialize();
  if (initialized.isErr()) {
    console.error("[xmux] failed to start", initialized.error);
    return;
  }

  console.log("[xmux] running. Send /new opencode in Telegram.");

  const shutdown = async () => {
    console.log("[xmux] shutting down...");
    const closed = await xmux.shutdown();
    if (closed.isErr()) {
      console.error("[xmux] failed to shut down", closed.error);
      return;
    }
    console.log("[xmux] stopped");
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit());
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit());
  });
}
