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

const modelMenuItemId = defineMenuItemId({ feature: "model", local: "open" });

const modelMenuItem = defineMenuCommandItem({
  id: modelMenuItemId,
  label: "Model",
  order: 100,
  style: "primary",
  visible: isMenuSessionIdle,
  command: () =>
    ({
      name: "model",
      options: { selector: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerModelMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, modelMenuItem);
}
