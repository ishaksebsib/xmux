import type { HarnessModelInfo, HarnessModelRef } from "@xmux/harness-core";
import { Result } from "better-result";
import {
  ModelSelectorAmbiguousError,
  ModelSelectorInvalidError,
  ModelSelectorNotFoundError,
} from "./errors";

export type ResolveModelSelectorError =
  | ModelSelectorInvalidError
  | ModelSelectorNotFoundError
  | ModelSelectorAmbiguousError;

interface ParsedModelSelector {
  readonly raw: string;
  readonly providerId?: string;
  readonly modelId: string;
  readonly variant?: string;
}

/** Formats a model ref as the chat-facing selector accepted by `/model`. */
export function formatModelSelector(ref: HarnessModelRef): string {
  const base = ref.providerId === undefined ? ref.modelId : `${ref.providerId}/${ref.modelId}`;
  return ref.variant === undefined ? base : `${base}@${ref.variant}`;
}

/** Resolves a chat selector to a canonical harness model ref from the available model list. */
export function resolveModelSelector<TModel extends HarnessModelInfo>(input: {
  readonly selector: string;
  readonly models: readonly TModel[];
}): Result<TModel, ResolveModelSelectorError> {
  const parsed = parseModelSelector(input.selector);

  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  const matches = input.models.filter((model) => modelMatchesSelector(model.ref, parsed.value));

  if (matches.length === 1) {
    const match = matches[0];
    if (match !== undefined) {
      return Result.ok(match);
    }
  }

  if (matches.length > 1) {
    return Result.err(
      new ModelSelectorAmbiguousError({
        selector: parsed.value.raw,
        matchingSelectors: matches.map((model) => formatModelSelector(model.ref)),
      }),
    );
  }

  return Result.err(
    new ModelSelectorNotFoundError({
      selector: parsed.value.raw,
      availableSelectors: input.models.map((model) => formatModelSelector(model.ref)),
    }),
  );
}

function parseModelSelector(
  selector: string,
): Result<ParsedModelSelector, ModelSelectorInvalidError> {
  const raw = selector.trim();

  if (raw.length === 0) {
    return Result.err(new ModelSelectorInvalidError({ selector, reason: "selector is empty" }));
  }

  const parsedVariant = splitVariant(raw);
  const providerSeparatorIndex = parsedVariant.selector.indexOf("/");
  const providerId =
    providerSeparatorIndex === -1
      ? undefined
      : parsedVariant.selector.slice(0, providerSeparatorIndex);
  const modelId =
    providerSeparatorIndex === -1
      ? parsedVariant.selector
      : parsedVariant.selector.slice(providerSeparatorIndex + 1);

  if (providerId !== undefined && providerId.trim().length === 0) {
    return Result.err(
      new ModelSelectorInvalidError({ selector: raw, reason: "provider id is empty" }),
    );
  }

  if (modelId.trim().length === 0) {
    return Result.err(
      new ModelSelectorInvalidError({ selector: raw, reason: "model id is empty" }),
    );
  }

  return Result.ok({
    raw,
    ...(providerId === undefined ? {} : { providerId }),
    modelId,
    ...(parsedVariant.variant === undefined ? {} : { variant: parsedVariant.variant }),
  });
}

function splitVariant(selector: string): { readonly selector: string; readonly variant?: string } {
  const variantSeparatorIndex = selector.lastIndexOf("@");

  if (variantSeparatorIndex <= 0) {
    return { selector };
  }

  const variant = selector.slice(variantSeparatorIndex + 1);
  if (variant.length === 0) {
    return { selector };
  }

  return {
    selector: selector.slice(0, variantSeparatorIndex),
    variant,
  };
}

function modelMatchesSelector(ref: HarnessModelRef, selector: ParsedModelSelector): boolean {
  if (selector.providerId !== undefined && ref.providerId !== selector.providerId) {
    return false;
  }

  if (ref.modelId !== selector.modelId) {
    return false;
  }

  return selector.variant === undefined || ref.variant === selector.variant;
}
