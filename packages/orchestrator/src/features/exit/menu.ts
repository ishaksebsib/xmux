import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import {
  defineMenuCommandItem,
  defineMenuItemId,
  isMenuSessionIdle,
  registerMenuItem,
} from "../menu";
import type { MenuCommandInvocation } from "../menu";

const exitMenuItemId = defineMenuItemId({ feature: "exit", local: "open" });

const exitMenuItem = defineMenuCommandItem({
  id: exitMenuItemId,
  label: "Exit session",
  order: 200,
  style: "secondary",
  visible: isMenuSessionIdle,
  command: () =>
    ({
      name: "exit",
      options: {},
    }) satisfies MenuCommandInvocation,
});

export function registerExitMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, exitMenuItem);
}
