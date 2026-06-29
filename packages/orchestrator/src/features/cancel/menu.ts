import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import {
  defineMenuCommandItem,
  defineMenuItemId,
  isMenuSessionRunning,
  registerMenuItem,
} from "../menu";
import type { MenuCommandInvocation } from "../menu";

const cancelMenuItemId = defineMenuItemId({ feature: "cancel", local: "run" });

const cancelMenuItem = defineMenuCommandItem({
  id: cancelMenuItemId,
  label: "Cancel",
  order: 50,
  style: "danger",
  visible: isMenuSessionRunning,
  command: () =>
    ({
      name: "cancel",
      options: {},
    }) satisfies MenuCommandInvocation,
});

export function registerCancelMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, cancelMenuItem);
}
