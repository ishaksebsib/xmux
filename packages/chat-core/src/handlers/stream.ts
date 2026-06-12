import type { ChatTextStreamChunk } from "../contracts";
import type { OpenedRuntime, StreamMessageRuntime, StreamReplyRuntime } from "./types";

export async function collectChatTextStream(
  chunks: AsyncIterable<ChatTextStreamChunk>,
): Promise<string> {
  let text = "";

  for await (const chunk of chunks) {
    if (chunk.type === "delta") {
      text += chunk.delta;
      continue;
    }

    if (chunk.type === "snapshot") {
      text = chunk.text;
      continue;
    }

    if (chunk.text !== undefined) {
      text = chunk.text;
    }
  }

  return text;
}

export function hasStreamMessageRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamMessageRuntime {
  return typeof (runtime as { readonly streamMessage?: unknown }).streamMessage === "function";
}

export function hasStreamReplyRuntime(
  runtime: OpenedRuntime,
): runtime is OpenedRuntime & StreamReplyRuntime {
  return typeof (runtime as { readonly streamReply?: unknown }).streamReply === "function";
}
