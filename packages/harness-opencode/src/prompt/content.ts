import type { HarnessAdapterPromptInput } from "@xmux/harness-core";
import type { OpenCodeCreateOptions } from "../types";
import type { OpenCodePromptPart } from "./types";

export function toPromptParts(
  content: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>["content"],
): OpenCodePromptPart[] {
  const parts: OpenCodePromptPart[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        if (part.text.length > 0) {
          parts.push({ type: "text", text: part.text });
        }
        break;
      case "image":
        parts.push({
          type: "file",
          mime: part.mimeType,
          filename: part.name,
          url: `data:${part.mimeType};base64,${part.data}`,
        });
        break;
      case "file":
        parts.push({
          type: "file",
          mime: part.mime,
          filename: part.name,
          url: part.uri,
        });
        break;
    }
  }

  return parts;
}
