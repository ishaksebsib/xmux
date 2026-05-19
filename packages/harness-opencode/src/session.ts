import type { PermissionRuleset, Session } from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "./errors";
import type { OpenCodeRuntime } from "./runtime";

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

function describeResponseError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

function toSessionInfo(session: Session): OpenCodeSessionInfo {
  return {
    directory: session.directory,
    path: session.path,
    projectId: session.projectID,
    slug: session.slug,
    version: session.version,
    workspaceId: session.workspaceID,
  };
}

async function requestSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
) {
  return Result.tryPromise({
    try: () =>
      runtime.client.session.create(
        {
          directory: input.cwd,
          parentID: input.adapterOptions.parentId,
          permission: input.adapterOptions.permission,
          title: input.title,
          workspace: input.adapterOptions.workspace,
          workspaceID: input.adapterOptions.workspaceId,
        },
        { signal: input.signal },
      ),
    catch: (cause) => new OpenCodeSessionRequestError({ cause }),
  });
}

export async function createSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterCreateSessionResult<OpenCodeSessionInfo>,
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(requestSession(runtime, input));
    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          detail: describeResponseError(response.error),
          reason: "OpenCode session create failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          reason: "OpenCode session create returned no session data",
        }),
      );
    }

    return Result.ok({
      sessionId: response.data.id,
      adapterData: toSessionInfo(response.data),
    });
  });
}

export async function resumeSession(
  runtime: OpenCodeRuntime,
  input: {
    readonly sessionId: string;
    readonly cwd?: string;
    readonly adapterOptions: OpenCodeCreateOptions;
    readonly signal?: AbortSignal;
  },
): Promise<
  ResultType<
    {
      readonly sessionId: string;
      readonly cwd?: string;
      readonly adapterData: OpenCodeSessionInfo;
    },
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.get(
            {
              sessionID: input.sessionId,
              directory: input.cwd,
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeSessionRequestError({ cause }),
      }),
    );

    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          detail: describeResponseError(response.error),
          reason: "OpenCode session resume failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          reason: "OpenCode session resume returned no session data",
        }),
      );
    }

    return Result.ok({
      sessionId: response.data.id,
      cwd: response.data.directory,
      adapterData: toSessionInfo(response.data),
    });
  });
}

export async function listSessions(
  runtime: OpenCodeRuntime,
  input: {
    readonly adapterOptions: OpenCodeCreateOptions;
    readonly signal?: AbortSignal;
  },
): Promise<
  ResultType<
    readonly { readonly sessionId: string; readonly cwd?: string; readonly adapterData: OpenCodeSessionInfo }[],
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.list(
            {
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeSessionRequestError({ cause }),
      }),
    );

    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          detail: describeResponseError(response.error),
          reason: "OpenCode session list failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        new OpenCodeSessionResponseError({
          status,
          reason: "OpenCode session list returned no data",
        }),
      );
    }

    return Result.ok(
      response.data.map((session) => ({
        sessionId: session.id,
        cwd: session.directory,
        adapterData: toSessionInfo(session),
      })),
    );
  });
}
