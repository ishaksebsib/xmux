import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { defineMenuCommandItem, defineMenuItemId, registerMenuItem } from "../menu";
import type { MenuCommandInvocation } from "../menu";

const newMenuItemId = defineMenuItemId({ feature: "new", local: "open" });

const newMenuItem = defineMenuCommandItem({
  id: newMenuItemId,
  label: "New session",
  order: 10,
  style: "success",
  visible: (state) => state.session.status === "inactive" && state.harnessIds.length > 0,
  command: () =>
    ({
      name: "new",
      options: { harnessId: undefined, title: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerNewMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, newMenuItem);
}
