import type { Unsubscribe } from "@xmux/chat-core";
import { Result, TaggedError } from "better-result";
import type { MenuItemId } from "./id";
import type { MenuCommandItem } from "./item";
import type { MenuState } from "./state";

export class MenuItemDuplicateError extends TaggedError("MenuItemDuplicateError")<{
  readonly menuItemId: MenuItemId;
  readonly message: string;
}>() {
  constructor(args: { readonly menuItemId: MenuItemId }) {
    super({ ...args, message: `Menu item already registered: ${args.menuItemId}` });
  }
}

export class MenuItemNotFoundError extends TaggedError("MenuItemNotFoundError")<{
  readonly menuItemId: MenuItemId;
  readonly message: string;
}>() {
  constructor(args: { readonly menuItemId: MenuItemId }) {
    super({ ...args, message: `Menu item not registered: ${args.menuItemId}` });
  }
}

export type MenuRegistrationError = MenuItemDuplicateError;
export type MenuLookupError = MenuItemNotFoundError;

export interface MenuRegistry {
  register(item: MenuCommandItem): Result<Unsubscribe, MenuRegistrationError>;
  get(id: MenuItemId): Result<MenuCommandItem, MenuLookupError>;
  list(): readonly MenuCommandItem[];
}

export function createMenuRegistry(): MenuRegistry {
  const items = new Map<MenuItemId, MenuCommandItem>();

  return {
    register(item) {
      if (items.has(item.id)) {
        return Result.err(new MenuItemDuplicateError({ menuItemId: item.id }));
      }

      items.set(item.id, item);
      return Result.ok(() => {
        const current = items.get(item.id);
        if (current === item) {
          items.delete(item.id);
        }
      });
    },

    get(id) {
      const item = items.get(id);
      return item === undefined
        ? Result.err(new MenuItemNotFoundError({ menuItemId: id }))
        : Result.ok(item);
    },

    list() {
      return [...items.values()].sort(compareMenuItems);
    },
  };
}

export function visibleMenuItems(input: {
  readonly registry: MenuRegistry;
  readonly state: MenuState;
}): readonly MenuCommandItem[] {
  return input.registry.list().filter((item) => item.visible(input.state));
}

function compareMenuItems(left: MenuCommandItem, right: MenuCommandItem): number {
  return left.order === right.order
    ? String(left.id).localeCompare(String(right.id))
    : left.order - right.order;
}
