import type { ChatActionButtonStyle, ChatCommandValues } from "@xmux/chat-core";
import type { Commands } from "../../commands";
import type { MenuState } from "./state";
import type { MenuItemId } from "./id";

export type MenuCommandInvocation = ChatCommandValues<Commands>;

export interface MenuCommandInput {
  readonly state: MenuState;
}

export interface MenuCommandItem<TCommand extends MenuCommandInvocation = MenuCommandInvocation> {
  readonly id: MenuItemId;
  readonly label: string;
  readonly description?: string;
  readonly order: number;
  readonly style?: ChatActionButtonStyle;
  readonly visible: (state: MenuState) => boolean;
  readonly command: (input: MenuCommandInput) => TCommand;
}

export function defineMenuCommandItem<const TCommand extends MenuCommandInvocation>(
  item: MenuCommandItem<TCommand>,
): MenuCommandItem<TCommand> {
  return item;
}
