import { Result, TaggedError } from "better-result";

const menuItemIdBrand: unique symbol = Symbol("MenuItemId");
const menuItemIdPattern = /^[a-z][a-z0-9-]{0,8}:[a-z][a-z0-9-]{0,8}$/;
const menuItemIdMaxLength = 19;

/** Compact, branded id used as menu callback payload. */
export type MenuItemId = string & { readonly [menuItemIdBrand]: "MenuItemId" };

export class MenuItemIdInvalidError extends TaggedError("MenuItemIdInvalidError")<{
  readonly value: string;
  readonly reason: string;
  readonly message: string;
}>() {
  constructor(args: { readonly value: string; readonly reason: string }) {
    super({
      ...args,
      message: `Invalid menu item id '${args.value}': ${args.reason}`,
    });
  }
}

export function defineMenuItemId(input: {
  readonly feature: string;
  readonly local: string;
}): MenuItemId {
  const id = `${input.feature}:${input.local}`;
  const parsed = parseMenuItemId(id);
  if (parsed.isErr()) {
    throw new TypeError(parsed.error.message);
  }
  return parsed.value;
}

export function parseMenuItemId(input: unknown): Result<MenuItemId, MenuItemIdInvalidError> {
  if (typeof input !== "string") {
    return Result.err(
      new MenuItemIdInvalidError({ value: String(input), reason: "expected a string" }),
    );
  }

  if (input.length > menuItemIdMaxLength) {
    return Result.err(
      new MenuItemIdInvalidError({
        value: input,
        reason: `expected at most ${menuItemIdMaxLength} characters`,
      }),
    );
  }

  if (!menuItemIdPattern.test(input)) {
    return Result.err(
      new MenuItemIdInvalidError({
        value: input,
        reason: "expected '<feature>:<local>' using lowercase letters, digits, or dashes",
      }),
    );
  }

  return Result.ok(input as MenuItemId);
}
