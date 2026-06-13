import { createChat } from "@xmux/chat-core";
import { createDiscordAdapter } from "@xmux/chat-adapter-discord";

export async function runDiscordLifecycleDemo() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;

  if (!token || !applicationId) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required");
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

  console.log("Discord adapter started. Press Ctrl+C to stop.");

  const close = async () => {
    const closed = await chat.close();
    if (closed.isErr()) console.error(closed.error);
  };

  process.once("SIGINT", () => void close().finally(() => process.exit()));
  process.once("SIGTERM", () => void close().finally(() => process.exit()));
}
