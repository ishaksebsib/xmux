import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class SpeechToTextConfigError extends TaggedError("SpeechToTextConfigError")<{
  reason: string;
  message: string;
}>() {
  constructor(args: { readonly reason: string }) {
    super({
      reason: args.reason,
      message: `Invalid speech-to-text configuration: ${args.reason}`,
    });
  }
}

export class SpeechToTextRequestError extends TaggedError("SpeechToTextRequestError")<{
  url: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly url: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Speech-to-text request failed for ${args.url}: ${describeCause(args.cause)}`,
    });
  }
}

export class SpeechToTextResponseError extends TaggedError("SpeechToTextResponseError")<{
  url: string;
  status: number;
  detail?: string;
  message: string;
}>() {
  constructor(args: { readonly url: string; readonly status: number; readonly detail?: string }) {
    super({
      ...args,
      message: `Speech-to-text provider returned status ${args.status} for ${args.url}${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

export class SpeechToTextParseError extends TaggedError("SpeechToTextParseError")<{
  url: string;
  format: string;
  message: string;
  cause?: unknown;
}>() {
  constructor(args: { readonly url: string; readonly format: string; readonly cause?: unknown }) {
    super({
      ...args,
      message: `Failed to parse ${args.format} speech-to-text response from ${args.url}${args.cause ? `: ${describeCause(args.cause)}` : ""}`,
    });
  }
}

export class SpeechToTextFileReadError extends TaggedError("SpeechToTextFileReadError")<{
  path: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly path: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to read speech-to-text audio file ${args.path}: ${describeCause(args.cause)}`,
    });
  }
}
