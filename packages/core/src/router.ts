import { createMessageSource, type MessageOf } from "./bus";
import type { AdapterRegistry } from "./adapter-registry";
import type { ChannelHandle, XmuxBus, XmuxMessageCatalog } from "./messages/xmux-catalog";

type CommandReceivedMessage = MessageOf<XmuxMessageCatalog, "xmux.command.received">;

export class Router {
  private readonly sessions = new Map<
    string,
    { id: string; harnessId: string; source: ChannelHandle }
  >();
  private subscriptionError?: unknown;

  constructor(
    bus: XmuxBus,
    private readonly registry: AdapterRegistry,
  ) {
    void bus
      .subscribe({
        type: "xmux.command.received",
        name: "router.command-received",
        handler: (message) => this.handleCommand(bus, message),
      })
      .then((subscribed) => {
        if (subscribed.isErr()) this.subscriptionError = subscribed.error;
      });
  }

  private async handleCommand(bus: XmuxBus, message: CommandReceivedMessage) {
    const command = message.data;
    if (command.command !== "new") return;

    const harnessId = command.args[0];
    if (!harnessId) return;

    const harness = this.registry.getHarness(harnessId);
    const chat = this.registry.getChat(command.source.adapterId);
    if (!harness || !chat) return;

    try {
      const sessionId = await harness.createSession({ name: `xmux-${Date.now()}` });
      this.sessions.set(sessionId, { id: sessionId, harnessId, source: command.source });
      const created = await bus.publish({
        type: "xmux.session.created",
        data: { sessionId, harnessId, source: command.source },
        source: createMessageSource("xmux.router"),
        correlationId: message.correlationId,
        causationId: message.id,
      });
      if (created.isErr()) {
        await chat.send(
          command.source.channelId,
          `Failed to publish session created event: ${created.error.message}`,
        );
        return;
      }
      await chat.send(command.source.channelId, `Created ${harnessId} session: ${sessionId}`);
    } catch (error) {
      await chat.send(
        command.source.channelId,
        `Failed to create ${harnessId} session: ${String(error)}`,
      );
    }
  }
}
