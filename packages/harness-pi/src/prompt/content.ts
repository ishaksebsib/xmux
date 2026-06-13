import type { HarnessAdapterPromptInput } from "@xmux/harness-core";
import type { PromptOptions } from "@earendil-works/pi-coding-agent";
import { Result, type Result as ResultType } from "better-result";
import { PiPromptContentError } from "../errors";
import type { PiCreateOptions } from "../types";

export type PiPromptContent = {
  readonly text: string;
  readonly images?: NonNullable<PromptOptions["images"]>;
};

export function toPiPromptContent(
  content: HarnessAdapterPromptInput<"pi", PiCreateOptions>["content"],
): ResultType<PiPromptContent, PiPromptContentError> {
  const textParts: string[] = [];
  const images: NonNullable<PromptOptions["images"]> = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        if (part.text.length > 0) textParts.push(part.text);
        break;
      case "image":
        images.push({ type: "image", data: part.data, mimeType: part.mimeType });
        break;
      case "file":
        return Result.err(
          new PiPromptContentError({
            reason: "file prompt content is not supported by the Pi SDK adapter yet",
          }),
        );
    }
  }

  const text = textParts.join("\n\n");
  if (text.length === 0 && images.length === 0) {
    return Result.err(new PiPromptContentError({ reason: "prompt content is empty" }));
  }

  return Result.ok({ text, images: images.length > 0 ? images : undefined });
}
