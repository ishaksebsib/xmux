import { TaggedError } from "better-result";

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class OpenCodeRuntimeOpenError extends TaggedError("OpenCodeRuntimeOpenError")<{
  mode: "embedded" | "external";
  message: string;
  cause: unknown;
}>() {
  constructor(args: { mode: "embedded" | "external"; cause: unknown }) {
    super({
      ...args,
      message: `Failed to open OpenCode ${args.mode} runtime: ${causeDetail(args.cause)}`,
    });
  }
}

export class OpenCodeSessionRequestError extends TaggedError("OpenCodeSessionRequestError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { cause: unknown }) {
    super({
      ...args,
      message: `OpenCode session request failed: ${causeDetail(args.cause)}`,
    });
  }
}

export class OpenCodeSessionResponseError extends TaggedError("OpenCodeSessionResponseError")<{
  status: number;
  detail?: string;
  message: string;
}>() {
  constructor(args: { status: number; detail?: string; reason: string }) {
    super({
      status: args.status,
      detail: args.detail,
      message: `${args.reason} (status ${args.status})${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

export class OpenCodeModelRequestError extends TaggedError("OpenCodeModelRequestError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { cause: unknown }) {
    super({
      ...args,
      message: `OpenCode model request failed: ${causeDetail(args.cause)}`,
    });
  }
}

export class OpenCodeModelResponseError extends TaggedError("OpenCodeModelResponseError")<{
  status: number;
  detail?: string;
  message: string;
}>() {
  constructor(args: { status: number; detail?: string; reason: string }) {
    super({
      status: args.status,
      detail: args.detail,
      message: `${args.reason} (status ${args.status})${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

export class OpenCodeModelSelectionError extends TaggedError("OpenCodeModelSelectionError")<{
  modelId: string;
  message: string;
}>() {
  constructor(args: { modelId: string; reason: string }) {
    super({
      modelId: args.modelId,
      message: `Invalid OpenCode model ${args.modelId}: ${args.reason}`,
    });
  }
}
