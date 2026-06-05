import type {
  ChatActionDefinition,
  ChatActionRegistry,
  ChatActionValueDefinition,
  ChatActionValuesDefinition,
} from "./types";
import type { ChatActionPayload } from "../contracts";

export type {
  ChatActionDefinition,
  ChatActionPayloadFor,
  ChatActionRegistry,
  ChatActionValueDefinition,
  ChatActionValueFor,
  ChatActionValues,
  ChatActionValuesDefinition,
  ChatActionValuesFor,
} from "./types";

/** Defines the action registry used to type interactive button actions. */
export function defineChatActions<const TActions extends ChatActionRegistry>(
  actions: TActions,
): TActions {
  return actions;
}

/** Defines one action id and its allowed values. */
export function defineChatAction<const TValues extends ChatActionValuesDefinition>(action: {
  readonly description?: string;
  readonly values: TValues;
}): ChatActionDefinition<TValues> {
  return action;
}

/** Defines one action value and preserves its payload type for sends and handlers. */
export function actionValue<
  TPayload extends ChatActionPayload | undefined = undefined,
>(): ChatActionValueDefinition<TPayload> {
  return {} as ChatActionValueDefinition<TPayload>;
}
