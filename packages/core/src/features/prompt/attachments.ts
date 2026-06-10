import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChatAttachment, ChatAttachmentContent } from "@xmux/chat-core";
import type { HarnessPromptContent } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { NormalizedPromptAttachmentsConfig } from "../../config";
import {
  PromptAttachmentReadError,
  PromptAttachmentStorageError,
  PromptAttachmentTooLargeError,
  PromptAttachmentUnsupportedError,
  type PromptAttachmentError,
} from "./errors";

export interface MaterializedPromptAttachments {
  readonly content: readonly HarnessPromptContent[];
  cleanup(): Promise<void>;
}

interface TempAttachmentStore {
  readonly path: () => string | undefined;
  ensure(): Promise<ResultType<string, PromptAttachmentStorageError>>;
  cleanup(): Promise<void>;
}

export async function materializePromptAttachments(input: {
  readonly text: string;
  readonly attachments: readonly ChatAttachment[];
  readonly config: NormalizedPromptAttachmentsConfig;
  readonly signal: AbortSignal;
}): Promise<ResultType<MaterializedPromptAttachments, PromptAttachmentError>> {
  const content: HarnessPromptContent[] = [];
  const tempStore = createTempAttachmentStore();

  if (input.text.length > 0) {
    content.push({ type: "text", text: input.text });
  }

  for (const attachment of input.attachments) {
    const materialized = await materializePromptAttachment({
      attachment,
      config: input.config,
      signal: input.signal,
      tempStore,
      index: content.length,
    });

    if (materialized.isErr()) {
      await tempStore.cleanup();
      return Result.err(materialized.error);
    }

    content.push(materialized.value);
  }

  return Result.ok({
    content,
    cleanup: () => tempStore.cleanup(),
  });
}

async function materializePromptAttachment(input: {
  readonly attachment: ChatAttachment;
  readonly config: NormalizedPromptAttachmentsConfig;
  readonly signal: AbortSignal;
  readonly tempStore: TempAttachmentStore;
  readonly index: number;
}): Promise<ResultType<HarnessPromptContent, PromptAttachmentError>> {
  const allowed = validateAttachmentPolicy({ attachment: input.attachment, config: input.config });
  if (allowed.isErr()) return Result.err(allowed.error);

  const opened = await input.attachment.open({
    signal: input.signal,
    maxBytes: input.config.maxBytes,
  });

  if (opened.isErr()) {
    return Result.err(
      new PromptAttachmentReadError({
        attachmentId: input.attachment.attachmentId,
        cause: opened.error,
      }),
    );
  }

  if (input.attachment.kind === "image") {
    return materializeImageAttachment({
      attachment: input.attachment,
      content: opened.value,
      maxBytes: input.config.maxBytes,
    });
  }

  return materializeFileAttachment({
    attachment: input.attachment,
    content: opened.value,
    maxBytes: input.config.maxBytes,
    tempStore: input.tempStore,
    index: input.index,
  });
}

function validateAttachmentPolicy(input: {
  readonly attachment: ChatAttachment;
  readonly config: NormalizedPromptAttachmentsConfig;
}): ResultType<void, PromptAttachmentUnsupportedError | PromptAttachmentTooLargeError> {
  if (!input.config.enabled) {
    return Result.err(
      new PromptAttachmentUnsupportedError({
        attachmentId: input.attachment.attachmentId,
        kind: input.attachment.kind,
        reason: "disabled",
      }),
    );
  }

  if (!input.config.kinds.includes(input.attachment.kind)) {
    return Result.err(
      new PromptAttachmentUnsupportedError({
        attachmentId: input.attachment.attachmentId,
        kind: input.attachment.kind,
        reason: "kind_disabled",
      }),
    );
  }

  if (
    input.attachment.sizeBytes !== undefined &&
    input.attachment.sizeBytes > input.config.maxBytes
  ) {
    return Result.err(
      new PromptAttachmentTooLargeError({
        attachmentId: input.attachment.attachmentId,
        maxBytes: input.config.maxBytes,
        actualBytes: input.attachment.sizeBytes,
      }),
    );
  }

  return Result.ok();
}

async function materializeImageAttachment(input: {
  readonly attachment: ChatAttachment;
  readonly content: ChatAttachmentContent;
  readonly maxBytes: number;
}): Promise<
  ResultType<HarnessPromptContent, PromptAttachmentUnsupportedError | PromptAttachmentTooLargeError>
> {
  const mimeType = input.content.mimeType ?? input.attachment.mimeType;
  if (mimeType === undefined || !mimeType.startsWith("image/")) {
    return Result.err(
      new PromptAttachmentUnsupportedError({
        attachmentId: input.attachment.attachmentId,
        kind: input.attachment.kind,
        reason: "missing_mime_type",
        detail: `Image attachment ${input.attachment.attachmentId} is missing an image MIME type`,
      }),
    );
  }

  const bytes = await collectBytes({
    attachmentId: input.attachment.attachmentId,
    chunks: input.content.chunks,
    maxBytes: input.maxBytes,
  });
  if (bytes.isErr()) return Result.err(bytes.error);

  return Result.ok({
    type: "image",
    data: bytes.value.toString("base64"),
    mimeType,
    name: input.content.filename ?? input.attachment.filename,
  });
}

async function materializeFileAttachment(input: {
  readonly attachment: ChatAttachment;
  readonly content: ChatAttachmentContent;
  readonly maxBytes: number;
  readonly tempStore: TempAttachmentStore;
  readonly index: number;
}): Promise<ResultType<HarnessPromptContent, PromptAttachmentError>> {
  const tempDir = await input.tempStore.ensure();
  if (tempDir.isErr()) return Result.err(tempDir.error);

  const filename = safeAttachmentFilename({
    attachmentId: input.attachment.attachmentId,
    filename: input.content.filename ?? input.attachment.filename,
    index: input.index,
  });
  const path = join(tempDir.value, filename);

  const written = await writeAttachmentFile({
    attachmentId: input.attachment.attachmentId,
    chunks: input.content.chunks,
    maxBytes: input.maxBytes,
    path,
  });
  if (written.isErr()) return Result.err(written.error);

  return Result.ok({
    type: "file",
    uri: pathToFileURL(path).href,
    mime: input.content.mimeType ?? input.attachment.mimeType ?? "application/octet-stream",
    name: input.content.filename ?? input.attachment.filename,
    description: attachmentDescription(input.attachment),
  });
}

async function collectBytes(input: {
  readonly attachmentId: string;
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly maxBytes: number;
}): Promise<ResultType<Buffer, PromptAttachmentTooLargeError>> {
  const buffers: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of input.chunks) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > input.maxBytes) {
      return Result.err(
        new PromptAttachmentTooLargeError({
          attachmentId: input.attachmentId,
          maxBytes: input.maxBytes,
          actualBytes: totalBytes,
        }),
      );
    }

    buffers.push(buffer);
  }

  return Result.ok(Buffer.concat(buffers, totalBytes));
}

async function writeAttachmentFile(input: {
  readonly attachmentId: string;
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly maxBytes: number;
  readonly path: string;
}): Promise<ResultType<void, PromptAttachmentStorageError | PromptAttachmentTooLargeError>> {
  const handle = await Result.tryPromise({
    try: () => open(input.path, "w"),
    catch: (cause) =>
      new PromptAttachmentStorageError({
        attachmentId: input.attachmentId,
        operation: "write_temp_file",
        cause,
      }),
  });
  if (handle.isErr()) return Result.err(handle.error);

  let totalBytes = 0;

  try {
    for await (const chunk of input.chunks) {
      totalBytes += chunk.byteLength;
      if (totalBytes > input.maxBytes) {
        return Result.err(
          new PromptAttachmentTooLargeError({
            attachmentId: input.attachmentId,
            maxBytes: input.maxBytes,
            actualBytes: totalBytes,
          }),
        );
      }

      const written = await Result.tryPromise({
        try: () => handle.value.write(chunk),
        catch: (cause) =>
          new PromptAttachmentStorageError({
            attachmentId: input.attachmentId,
            operation: "write_temp_file",
            cause,
          }),
      });
      if (written.isErr()) return Result.err(written.error);
    }

    return Result.ok();
  } finally {
    await handle.value.close().catch(() => undefined);
  }
}

function createTempAttachmentStore(): TempAttachmentStore {
  let tempDir: string | undefined;

  return {
    path: () => tempDir,

    async ensure() {
      if (tempDir !== undefined) return Result.ok(tempDir);

      const created = await Result.tryPromise({
        try: () => mkdtemp(join(tmpdir(), "xmux-attachments-")),
        catch: (cause) => new PromptAttachmentStorageError({ operation: "create_temp_dir", cause }),
      });

      if (created.isErr()) return created;
      tempDir = created.value;
      return Result.ok(tempDir);
    },

    async cleanup() {
      const path = tempDir;
      tempDir = undefined;
      if (path === undefined) return;
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

function safeAttachmentFilename(input: {
  readonly attachmentId: string;
  readonly filename?: string;
  readonly index: number;
}): string {
  const fallback = `${input.attachmentId}.bin`;
  const raw = input.filename?.trim() || fallback;
  const sanitized = raw
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/^\.+$/, "-")
    .slice(0, 120);

  return `${String(input.index).padStart(3, "0")}-${sanitized || fallback}`;
}

function attachmentDescription(attachment: ChatAttachment): string | undefined {
  const parts = [`Chat attachment ${attachment.attachmentId}`, `kind: ${attachment.kind}`];
  if (attachment.disposition !== undefined) parts.push(`disposition: ${attachment.disposition}`);
  return parts.join(", ");
}
