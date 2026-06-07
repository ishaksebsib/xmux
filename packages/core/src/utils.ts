export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

/** Renders an unknown thrown/rejected cause as a human-readable string. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
