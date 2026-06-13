import { createChat } from "@xmux/chat-core";
import { createDiscordAdapter } from "@xmux/chat-adapter-discord";

export async function runDiscordDemo() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const channelId = process.env.DISCORD_TEST_CHANNEL_ID;

  if (!token || !applicationId || !channelId) {
    throw new Error(
      "DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_TEST_CHANNEL_ID are required",
    );
  }

  const chat = createChat({
    adapters: {
      discord: createDiscordAdapter({
        token,
        applicationId,
        commandRegistration: { scope: { type: "none" } },
      }),
    },
    commands: {},
  });

  chat.on("error", (event) => console.error("[discord:error]", event.error));

  const started = await chat.start();
  if (started.isErr()) throw started.error;

  try {
    const typed = await chat.typingIndicator({
      chatId: "discord",
      conversationId: channelId,
      adapterOptions: {},
    });
    if (typed.isErr()) throw typed.error;

    const sent = await chat.sendMessage({
      chatId: "discord",
      conversationId: channelId,
      text: "**Hello** from xmux Discord adapter. Mentions like @everyone must not ping.",
      format: "markdown",
      adapterOptions: {},
    });
    if (sent.isErr()) throw sent.error;

    console.log("Discord message sent:", sent.value.messageId);

    const quoted = await chat.reply({
      chatId: "discord",
      conversationId: channelId,
      messageId: sent.value.messageId,
      text: "Quote reply from the same Discord demo flow.",
      mode: "quote",
      adapterOptions: {},
    });
    if (quoted.isErr()) throw quoted.error;

    console.log("Discord quote reply sent:", quoted.value.messageId);
    console.log("Discord demo bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    await chat.close();
    throw error;
  }

  const close = async () => {
    const closed = await chat.close();
    if (closed.isErr()) {
      console.error("Failed to close Discord demo bot", closed.error);
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
