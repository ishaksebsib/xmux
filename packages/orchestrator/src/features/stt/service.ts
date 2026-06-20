import type { ChatAttachment, ChatMessage } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createSpeechToTextClient, type SpeechToTextAudioInput } from "@xmux/stt";
import { Result, type Result as ResultType } from "better-result";
import type { HandlerContext } from "../../ctx";
import { threadFromChatEvent } from "../utils";
import type { PromptMessageEvent } from "../prompt";
import {
  SttAttachmentReadError,
  SttAttachmentTooLargeError,
  SttClientCreateError,
  SttDisabledError,
  SttTranscriptionError,
  SttUnsupportedAudioMessageError,
  type SttTranscribeError,
} from "./errors";
import type { SttRun } from "./run-registry";

export type AudioMessageClassification =
  | { readonly type: "no_audio" }
  | { readonly type: "single_audio"; readonly attachment: ChatAttachment }
  | { readonly type: "unsupported"; readonly error: SttUnsupportedAudioMessageError };

export function classifyAudioMessage(message: ChatMessage): AudioMessageClassification {
  const attachments = message.attachments;
  const audio = attachments.filter((attachment) => attachment.kind === "audio");

  if (audio.length === 0) return { type: "no_audio" };

  if (audio.length === 1 && attachments.length === 1) {
    const attachment = audio[0];
    if (attachment !== undefined) return { type: "single_audio", attachment };
  }

  return {
    type: "unsupported",
    error: new SttUnsupportedAudioMessageError({
      reason: audio.length > 1 ? "multiple_audio" : "mixed_attachments",
      audioCount: audio.length,
      attachmentKinds: attachments.map((attachment) => attachment.kind),
    }),
  };
}

export function startSttRun<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent;
  readonly attachment: ChatAttachment;
}): SttRun {
  return input.ctx.app.services.sttRuns.start({
    thread: threadFromChatEvent(input.event),
    conversation: input.event.conversation,
    message: {
      chatId: input.event.message.chatId,
      conversationId: input.event.message.conversationId,
      messageId: input.event.message.messageId,
    },
    caption: input.event.message.text,
    actor: input.event.message.actor,
    requester: input.ctx.actor,
    attachmentId: input.attachment.attachmentId,
    now: input.ctx.app.services.now().toISOString(),
  });
}

export async function transcribeAudioAttachment<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly attachment: ChatAttachment;
  readonly signal: AbortSignal;
}): Promise<ResultType<string, SttTranscribeError>> {
  const config = input.ctx.app.config.stt;
  if (!config.enabled) {
    return Result.err(new SttDisabledError());
  }

  const client = createSpeechToTextClient(config.clientConfig);
  if (client.isErr()) return Result.err(new SttClientCreateError({ cause: client.error }));

  const opened = await input.attachment.open({ maxBytes: config.maxBytes, signal: input.signal });
  if (opened.isErr()) {
    return Result.err(
      new SttAttachmentReadError({
        attachmentId: input.attachment.attachmentId,
        cause: opened.error,
      }),
    );
  }

  const bytes = await collectBytes({
    attachmentId: input.attachment.attachmentId,
    chunks: opened.value.chunks,
    maxBytes: config.maxBytes,
    signal: input.signal,
  });
  if (bytes.isErr()) return Result.err(bytes.error);

  const audio: SpeechToTextAudioInput = {
    source: "bytes",
    data: bytes.value,
    filename:
      opened.value.filename ??
      input.attachment.filename ??
      `voice-${input.attachment.attachmentId}.ogg`,
    mimeType: opened.value.mimeType ?? input.attachment.mimeType,
  };

  const transcript = await client.value.transcribe({
    audio,
    language: config.language,
    signal: input.signal,
  });

  return Result.map(
    Result.mapError(transcript, (cause) => new SttTranscriptionError({ cause })),
    (value) => value.text,
  );
}

async function collectBytes(input: {
  readonly attachmentId: string;
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}): Promise<ResultType<Uint8Array, SttAttachmentTooLargeError | SttAttachmentReadError>> {
  const buffers: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for await (const chunk of input.chunks) {
      if (input.signal.aborted) {
        return Result.err(
          new SttAttachmentReadError({
            attachmentId: input.attachmentId,
            cause: input.signal.reason ?? "aborted",
          }),
        );
      }

      totalBytes += chunk.byteLength;
      if (totalBytes > input.maxBytes) {
        return Result.err(
          new SttAttachmentTooLargeError({
            attachmentId: input.attachmentId,
            maxBytes: input.maxBytes,
            actualBytes: totalBytes,
          }),
        );
      }
      buffers.push(chunk);
    }
  } catch (cause) {
    return Result.err(new SttAttachmentReadError({ attachmentId: input.attachmentId, cause }));
  }

  const data = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buffer of buffers) {
    data.set(buffer, offset);
    offset += buffer.byteLength;
  }

  return Result.ok(data);
}

export function composePromptFromTranscript(input: {
  readonly caption: string;
  readonly transcript: string;
}): string {
  const caption = input.caption.trim();
  if (caption.length === 0) return input.transcript;
  return [caption, "", "Voice transcription:", input.transcript].join("\n");
}
