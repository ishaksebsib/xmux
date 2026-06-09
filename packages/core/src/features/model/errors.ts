import { TaggedError } from "better-result";

/** Returned when a model selector cannot be parsed. */
export class ModelSelectorInvalidError extends TaggedError("ModelSelectorInvalidError")<{
  readonly selector: string;
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly reason: string }) {
    super({ ...args, message: `Invalid model selector '${args.selector}': ${args.reason}` });
  }
}

/** Returned when a model selector does not match available models. */
export class ModelSelectorNotFoundError extends TaggedError("ModelSelectorNotFoundError")<{
  readonly selector: string;
  readonly availableSelectors: readonly string[];
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly availableSelectors: readonly string[] }) {
    super({ ...args, message: `Model not found: ${args.selector}` });
  }
}

/** Returned when a provider-less or variant-less selector matches multiple models. */
export class ModelSelectorAmbiguousError extends TaggedError("ModelSelectorAmbiguousError")<{
  readonly selector: string;
  readonly matchingSelectors: readonly string[];
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly matchingSelectors: readonly string[] }) {
    super({ ...args, message: `Model selector is ambiguous: ${args.selector}` });
  }
}

/** Returned when a model action button payload is malformed or stale. */
export class ModelActionPayloadInvalidError extends TaggedError("ModelActionPayloadInvalidError")<{
  readonly payload: string;
  readonly message: string;
}>() {
  constructor(args: { readonly payload: string; readonly reason: string }) {
    super({ ...args, message: `Invalid model action payload '${args.payload}': ${args.reason}` });
  }
}
