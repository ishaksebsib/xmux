import type { Model, PermissionRuleset, Provider, Session } from "@opencode-ai/sdk/v2";
import type { HarnessAdapterSessionInfo, HarnessModelRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionResponseError } from "../errors";

export type OpenCodeCreateOptions = {
  readonly parentId?: string;
  readonly permission?: PermissionRuleset;
  readonly workspace?: string;
  readonly workspaceId?: string;
};

export type OpenCodeSessionInfo = {
  readonly directory: string;
  readonly path?: string;
  readonly projectId: string;
  readonly slug: string;
  readonly version: string;
  readonly workspaceId?: string;
};

export type OpenCodeModelVariant = {
  readonly id: string;
  readonly data: Record<string, unknown>;
};

export type OpenCodeModelInfo = {
  readonly provider: Provider;
  readonly model: Model;
  readonly variant?: OpenCodeModelVariant;
};

export function describeResponseError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

export type OpenCodeSdkResponse<TData> = {
  readonly data?: TData;
  readonly error?: unknown;
  readonly response?: { readonly status?: number };
};

export function toResponseResult<TData, TError>(args: {
  readonly response: OpenCodeSdkResponse<TData>;
  readonly toError: (args: {
    readonly status: number;
    readonly detail?: unknown;
    readonly reason: string;
  }) => TError;
  readonly failureReason: string;
  readonly missingReason: string;
}): ResultType<TData, TError> {
  const status = args.response.response?.status ?? 0;

  if (args.response.error !== undefined) {
    return Result.err(
      args.toError({
        status,
        detail: args.response.error,
        reason: args.failureReason,
      }),
    );
  }

  if (args.response.data === undefined) {
    return Result.err(
      args.toError({
        status,
        reason: args.missingReason,
      }),
    );
  }

  return Result.ok(args.response.data);
}

export function toSessionInfo(session: Session): OpenCodeSessionInfo {
  return {
    directory: session.directory,
    path: session.path,
    projectId: session.projectID,
    slug: session.slug,
    version: session.version,
    workspaceId: session.workspaceID,
  };
}

export function toSessionModel(session: Session): HarnessModelRef | undefined {
  return session.model
    ? {
        providerId: session.model.providerID,
        modelId: session.model.id,
        ...(session.model.variant === undefined ? {} : { variant: session.model.variant }),
      }
    : undefined;
}

export function toOpenCodeCreateModel(
  model: HarnessModelRef | undefined,
): { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined {
  if (!model?.providerId) return undefined;

  return {
    id: model.modelId,
    providerID: model.providerId,
    ...(model.variant === undefined ? {} : { variant: model.variant }),
  };
}

export function toAdapterSession(args: {
  readonly session: Session;
  readonly model?: HarnessModelRef;
}): HarnessAdapterSessionInfo<OpenCodeSessionInfo> {
  return {
    sessionId: args.session.id,
    cwd: args.session.directory,
    title: args.session.title,
    model: args.model ?? toSessionModel(args.session),
    adapterData: toSessionInfo(args.session),
  };
}

export function toSessionResponseError(args: {
  readonly status: number;
  readonly detail?: unknown;
  readonly reason: string;
}): OpenCodeSessionResponseError {
  return new OpenCodeSessionResponseError({
    status: args.status,
    detail: args.detail === undefined ? undefined : describeResponseError(args.detail),
    reason: args.reason,
  });
}
