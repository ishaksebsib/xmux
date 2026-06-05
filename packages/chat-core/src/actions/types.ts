import type { ChatActionPayload } from "../contracts";

/** Metadata for one allowed value of a typed chat action. */
export interface ChatActionValueDefinition<
  TPayload extends ChatActionPayload | undefined = ChatActionPayload | undefined,
> {
  readonly payload?: TPayload;
}

/** Value map for one action id, keyed by stable action value. */
export type ChatActionValuesDefinition = Record<
  string,
  ChatActionValueDefinition<ChatActionPayload | undefined>
>;

/** Platform-neutral action metadata used to type outbound buttons and inbound clicks. */
export interface ChatActionDefinition<
  TValues extends ChatActionValuesDefinition = ChatActionValuesDefinition,
> {
  readonly description?: string;
  readonly values: TValues;
}

/** Action registry passed to chat-core for type-safe button actions. */
export type ChatActionRegistry = Record<string, ChatActionDefinition<ChatActionValuesDefinition>>;

/** Runtime payload type inferred for one action id/value pair. */
export type ChatActionPayloadFor<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions,
  TValue extends keyof TActions[TActionId]["values"],
> =
  TActions[TActionId]["values"][TValue] extends ChatActionValueDefinition<infer TPayload>
    ? TPayload
    : never;

/** Runtime action invocation inferred for one action id and value. */
export type ChatActionValueFor<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions,
  TValue extends keyof TActions[TActionId]["values"],
> = {
  readonly actionId: Extract<TActionId, string>;
  readonly value: Extract<TValue, string>;
} & ([ChatActionPayloadFor<TActions, TActionId, TValue>] extends [undefined]
  ? { readonly payload?: undefined }
  : { readonly payload: ChatActionPayloadFor<TActions, TActionId, TValue> });

/** Runtime action invocation union inferred for one action id. */
export type ChatActionValuesFor<
  TActions extends ChatActionRegistry,
  TActionId extends keyof TActions,
> = {
  readonly [TValue in keyof TActions[TActionId]["values"]]: ChatActionValueFor<
    TActions,
    TActionId,
    TValue
  >;
}[keyof TActions[TActionId]["values"]];

/** Runtime action invocation union inferred from an action registry. */
export type ChatActionValues<TActions extends ChatActionRegistry> = {
  readonly [TActionId in keyof TActions]: ChatActionValuesFor<TActions, TActionId>;
}[keyof TActions];
