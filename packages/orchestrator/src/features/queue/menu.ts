import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { defineMenuCommandItem, defineMenuItemId, registerMenuItem } from "../menu";
import type { MenuCommandInvocation } from "../menu";

const queueMenuItemId = defineMenuItemId({ feature: "queue", local: "list" });

const queueMenuItem = defineMenuCommandItem({
  id: queueMenuItemId,
  label: "Queue",
  order: 60,
  style: "secondary",
  visible: (state) => state.session.status === "active" && state.session.queueCount > 0,
  command: () =>
    ({
      name: "queue",
      options: { action: "list", value: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerQueueMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, queueMenuItem);
}
