import {
  createMemoryBus,
  type MessageBus,
  type MessageCatalogDefinition,
  type MessageDefinition,
} from "../bus";

/** Normalized identifier for a chat destination. */
export type ChannelHandle = {
  adapterId: string;
  channelId: string;
};

/** Built-in xmux message catalog shared by the router and bundled adapters. */
export type XmuxMessageCatalog = {
  readonly "xmux.adapter.ready": MessageDefinition<"event", { readonly adapterId: string }>;
  readonly "xmux.command.received": MessageDefinition<
    "event",
    { readonly source: ChannelHandle; readonly command: string; readonly args: readonly string[] }
  >;
  readonly "xmux.session.created": MessageDefinition<
    "event",
    { readonly sessionId: string; readonly harnessId: string; readonly source: ChannelHandle }
  >;
};

export const xmuxMessageCatalog = {
  "xmux.adapter.ready": { kind: "event" },
  "xmux.command.received": { kind: "event" },
  "xmux.session.created": { kind: "event" },
} satisfies MessageCatalogDefinition<XmuxMessageCatalog>;

export type XmuxBus = MessageBus<XmuxMessageCatalog>;

export function createBus(): XmuxBus {
  return createMemoryBus({ catalog: xmuxMessageCatalog });
}
