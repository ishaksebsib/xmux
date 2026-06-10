import type { HarnessAdapterPromptInput } from "@xmux/harness-core";
import type { OpenCodeCreateOptions } from "../types";
import type { OpenCodePromptPart } from "./types";

function toOpenCodeFileMime(input: { readonly uri: string; readonly mime: string }): string {
  if (!input.uri.startsWith("file://")) return input.mime;

  const mime = input.mime.toLocaleLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) {
    return input.mime;
  }
  if (mime === "application/pdf") return input.mime;

  return "text/plain";
}

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
          mime: toOpenCodeFileMime({ uri: part.uri, mime: part.mime }),
          filename: part.name,
          url: part.uri,
        });
        break;
    }
  }

  return parts;
}
