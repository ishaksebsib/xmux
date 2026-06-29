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

const thinkingMenuItemId = defineMenuItemId({ feature: "thinking", local: "open" });

const thinkingMenuItem = defineMenuCommandItem({
  id: thinkingMenuItemId,
  label: "Thinking",
  order: 110,
  style: "secondary",
  visible: isMenuSessionIdle,
  command: () =>
    ({
      name: "thinking",
      options: { level: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerThinkingMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, thinkingMenuItem);
}
