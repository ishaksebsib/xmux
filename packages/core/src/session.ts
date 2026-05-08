import type { CreatedSessionFor, HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { XmuxDeliveryMode } from "./contracts";
import type { Brand } from "./utils";

export type XmuxSessionId = Brand<string, "XmuxSessionId">;

type XmuxSessionStatus = "ready";

type XmuxSessionBase = {
  readonly id: XmuxSessionId;
  readonly status: XmuxSessionStatus;
  readonly deliveryMode: XmuxDeliveryMode;
};

export type XmuxManagedSessionFor<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
> = XmuxSessionBase & {
  readonly harnessSession: CreatedSessionFor<TAdapters, THarnessId>;
};

export type XmuxManagedSession<TAdapters extends HarnessAdapterDefinitions<TAdapters>> = {
  readonly [THarnessId in keyof TAdapters]: XmuxManagedSessionFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export function toXmuxSessionId(value: string): XmuxSessionId {
  return value as XmuxSessionId;
}

export function defineManagedSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
>(args: {
  readonly deliveryMode: XmuxDeliveryMode;
  readonly harnessSession: CreatedSessionFor<TAdapters, THarnessId>;
}): XmuxManagedSessionFor<TAdapters, THarnessId> {
  return {
    id: toXmuxSessionId(crypto.randomUUID()),
    status: "ready",
    deliveryMode: args.deliveryMode,
    harnessSession: args.harnessSession,
  };
}
