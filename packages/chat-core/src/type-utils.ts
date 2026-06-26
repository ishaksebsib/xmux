import type { ChatAdapterObject } from "./contracts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Keys of `TValue` that are not optional. */
export type RequiredKeys<TValue extends ChatAdapterObject> = {
  [TKey in keyof TValue]-?: {} extends Pick<TValue, TKey> ? never : TKey;
}[keyof TValue];

/**
 * Makes `adapterOptions` optional when an adapter declares no required options,
 * and required otherwise, so callers only pass options the adapter truly needs.
 */
export type AdapterOptionsProp<TAdapterOptions extends ChatAdapterObject> = [
  RequiredKeys<TAdapterOptions>,
] extends [never]
  ? { readonly adapterOptions?: TAdapterOptions }
  : { readonly adapterOptions: TAdapterOptions };
