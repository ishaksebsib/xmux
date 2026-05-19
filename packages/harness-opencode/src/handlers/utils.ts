import type { PermissionRuleset, Session } from "@opencode-ai/sdk/v2";
import type { HarnessAdapterSessionInfo } from "@xmux/harness-core";
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

export function toAdapterSession(session: Session): HarnessAdapterSessionInfo<OpenCodeSessionInfo> {
  return {
    sessionId: session.id,
    cwd: session.directory,
    title: session.title,
    adapterData: toSessionInfo(session),
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
