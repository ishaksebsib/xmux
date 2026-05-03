import type { XmuxBus } from "./bus";

export type AdapterType = "chat" | "harness";

export type XmuxAdapter = {
  readonly id: string;
  readonly type: AdapterType;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type ChatAdapter = XmuxAdapter & {
  readonly type: "chat";
  send(channelId: string, text: string): Promise<void>;
};

export type HarnessAdapter = XmuxAdapter & {
  readonly type: "harness";
  createSession(input?: { name?: string; cwd?: string }): Promise<string>;
};

export class AdapterRegistry {
  private readonly chat = new Map<string, ChatAdapter>();
  private readonly harness = new Map<string, HarnessAdapter>();

  constructor(private readonly bus: XmuxBus) {}

  register(adapter: ChatAdapter | HarnessAdapter) {
    if (adapter.type === "chat") {
      this.chat.set(adapter.id, adapter);
      return;
    }

    this.harness.set(adapter.id, adapter);
  }

  getChat(id: string) {
    return this.chat.get(id);
  }

  getHarness(id: string) {
    return this.harness.get(id);
  }

  async startAll() {
    for (const adapter of this.harness.values()) {
      await adapter.start();
      await this.bus.emit("adapter:ready", { adapterId: adapter.id });
    }

    for (const adapter of this.chat.values()) {
      await adapter.start();
      await this.bus.emit("adapter:ready", { adapterId: adapter.id });
    }
  }

  async stopAll() {
    for (const adapter of this.chat.values()) {
      await adapter.stop();
    }

    for (const adapter of this.harness.values()) {
      await adapter.stop();
    }
  }
}
