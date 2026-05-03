import type { ChannelHandle, XmuxBus } from "./bus";
import type { AdapterRegistry } from "./adapter-registry";

export class Router {
  private readonly sessions = new Map<string, { id: string; harnessId: string; source: ChannelHandle }>();

  constructor(
    bus: XmuxBus,
    private readonly registry: AdapterRegistry,
  ) {
    bus.on("command:received", ({ data }) => this.handleCommand(bus, data));
  }

  private async handleCommand(
    bus: XmuxBus,
    command: { source: ChannelHandle; command: string; args: string[] },
  ) {
    if (command.command !== "new") return;

    const harnessId = command.args[0];
    if (!harnessId) return;

    const harness = this.registry.getHarness(harnessId);
    const chat = this.registry.getChat(command.source.adapterId);
    if (!harness || !chat) return;

    try {
      const sessionId = await harness.createSession({ name: `xmux-${Date.now()}` });
      this.sessions.set(sessionId, { id: sessionId, harnessId, source: command.source });
      await bus.emit("session:created", { sessionId, harnessId, source: command.source });
      await chat.send(command.source.channelId, `Created ${harnessId} session: ${sessionId}`);
    } catch (error) {
      await chat.send(command.source.channelId, `Failed to create ${harnessId} session: ${String(error)}`);
    }
  }
}
