import type { SpeechToTextFormValue } from "../../types";
import type { ValidatedAudioInput, ValidatedTranscribeInput } from "./validation";

type BlobConstructorPart = NonNullable<ConstructorParameters<typeof Blob>[0]>[number];

export function createTranscriptionFormData(input: ValidatedTranscribeInput): FormData {
  const body = new FormData();
  const file = toFormDataFile(input.audio);

  body.append("file", file.blob, file.filename);
  body.append("model", input.model);
  appendOptional(body, "language", input.language);
  appendOptional(body, "prompt", input.prompt);
  appendOptional(body, "temperature", input.temperature);
  body.append("response_format", input.responseFormat);

  for (const granularity of input.timestampGranularities) {
    body.append("timestamp_granularities[]", granularity);
  }

  for (const [name, value] of Object.entries(input.extraBody)) {
    appendFormValue(body, name, value);
  }

  return body;
}

function toFormDataFile(input: ValidatedAudioInput): {
  readonly blob: Blob;
  readonly filename: string;
} {
  if (input.source === "blob") {
    const blob = input.mimeType ? new Blob([input.data], { type: input.mimeType }) : input.data;
    return { blob, filename: input.filename };
  }

  return {
    blob: new Blob([toBlobPart(input.data)], { type: input.mimeType }),
    filename: input.filename,
  };
}

function toBlobPart(input: ArrayBuffer | ArrayBufferView): BlobConstructorPart {
  if (input instanceof ArrayBuffer) return input;

  const bytes = new Uint8Array(input.byteLength);
  bytes.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  return bytes;
}

function appendOptional(body: FormData, name: string, value: string | number | undefined): void {
  if (value !== undefined) body.append(name, String(value));
}

function appendFormValue(body: FormData, name: string, value: SpeechToTextFormValue): void {
  if (value instanceof Blob) {
    body.append(name, value);
    return;
  }

  body.append(name, String(value));
}
