import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter, type TelegramAdapterConfig } from "@chat-adapter/telegram";
import { Chat, type Message, type Thread } from "chat";
import { createMessageSource } from "../bus";
import type { XmuxBus } from "../messages/xmux-catalog";

type TelegramChat = Chat<{ telegram: ReturnType<typeof createTelegramAdapter> }>;

export class TelegramMediaAdapter {
  readonly id = "telegram";
  readonly type = "chat" as const;
  private readonly chat: TelegramChat;
  private readonly threads = new Map<string, Thread>();

  constructor(
    private readonly bus: XmuxBus,
    config: TelegramAdapterConfig = {},
  ) {
    this.chat = new Chat({
      userName: "xmux",
      adapters: {
        telegram: createTelegramAdapter(config),
      },
      state: createMemoryState(),
    });

    const handleMessage = (thread: Thread, message: Message) => this.handleMessage(thread, message);
    this.chat.onDirectMessage(handleMessage);
    this.chat.onNewMessage(/^new\s+opencode$/i, handleMessage);
  }

  async start() {
    await this.chat.initialize();
  }

  async send(channelId: string, text: string) {
    await this.threads.get(channelId)?.post(text);
  }

  async stop() {
    await this.chat.shutdown();
  }

  private async handleMessage(thread: Thread, message: Message) {
    this.threads.set(thread.id, thread);

    if (message.text.trim().toLowerCase() !== "new opencode") return;

    const published = await this.bus.publish({
      type: "xmux.command.received",
      data: {
        source: { adapterId: this.id, channelId: thread.id },
        command: "new",
        args: ["opencode"],
      },
      source: createMessageSource(this.id),
      subject: thread.id,
    });
    if (published.isErr()) {
      await thread.post(`Failed to route command: ${published.error.message}`);
    }
  }
}
