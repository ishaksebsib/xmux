import type { Model, PermissionRuleset, Provider, Session } from "@opencode-ai/sdk/v2";
import type { HarnessAdapterSessionInfo, HarnessModelRef } from "@xmux/harness-core";
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

export function toAdapterSession(args: {
  readonly session: Session;
  readonly model?: HarnessModelRef;
}): HarnessAdapterSessionInfo<OpenCodeSessionInfo> {
  return {
    sessionId: args.session.id,
    cwd: args.session.directory,
    title: args.session.title,
    model: args.model,
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
