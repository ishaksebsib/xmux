import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { ListSessionsError } from "@xmux/harness-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { CommandHarnessNotConfiguredError } from "../../errors";
import { requireConfiguredHarnessId } from "../../utils";
import {
  allHarnessesFailed,
  findSessionsByShortId,
  listHarnessSelectableSessions,
  listSessionSelectionCatalog,
  type ListedSelectableSession,
  type SessionSelectionGroup,
  type SessionSelectionListFailure,
} from "../session-selection";
import {
  SessionCommandIncompleteTargetError,
  SessionListAllFailedError,
  SessionShortIdAmbiguousError,
  SessionShortIdNotFoundError,
} from "./errors";

export type ParsedTarget =
  | { readonly status: "list" }
  | { readonly status: "select"; readonly harnessId: string; readonly shortId: string };

export function parseSessionTarget(input: {
  readonly command: string;
  readonly harnessId?: string;
  readonly shortId?: string;
}): Result<ParsedTarget, SessionCommandIncompleteTargetError> {
  const harnessId = input.harnessId?.trim();
  const shortId = input.shortId?.trim();

  if (!harnessId && !shortId) {
    return Result.ok({ status: "list" });
  }

  if (!harnessId || !shortId) {
    return Result.err(
      new SessionCommandIncompleteTargetError({
        command: input.command,
        ...(harnessId ? { harnessId } : {}),
        ...(shortId ? { shortId } : {}),
      }),
    );
  }

  return Result.ok({ status: "select", harnessId, shortId });
}

export type SelectSessionByShortIdError =
  | CommandHarnessNotConfiguredError
  | ListSessionsError
  | SessionShortIdNotFoundError
  | SessionShortIdAmbiguousError;

export async function selectSessionByShortId<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
  readonly harnessId: string;
  readonly shortId: string;
}): Promise<Result<ListedSelectableSession, SelectSessionByShortIdError>> {
  return Result.gen(async function* () {
    const configuredHarnessId = yield* requireConfiguredHarnessId({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      onMissing: (args) => new CommandHarnessNotConfiguredError(args),
    });

    const listed = yield* Result.await(
      listHarnessSelectableSessions({
        ctx: input.ctx,
        harnessId: configuredHarnessId,
        cwd: input.cwd,
      }),
    );

    const matches = findSessionsByShortId({
      sessions: listed.sessions,
      shortId: input.shortId,
    });

    if (matches.length === 0) {
      return Result.err(
        new SessionShortIdNotFoundError({
          harnessId: input.harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
        }),
      );
    }

    if (matches.length > 1) {
      return Result.err(
        new SessionShortIdAmbiguousError({
          harnessId: input.harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
          matchingSessionIds: matches.map((session) => session.sessionId),
        }),
      );
    }

    const selected = matches[0];
    if (!selected) {
      return Result.err(
        new SessionShortIdNotFoundError({
          harnessId: input.harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
        }),
      );
    }

    return Result.ok(selected);
  });
}

export interface ListSessionsOutput {
  readonly status: "listed";
  readonly cwd: string;
  readonly groups: readonly SessionSelectionGroup[];
  readonly failures: readonly SessionSelectionListFailure[];
}

export async function listSessionsForCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
  readonly maxSessionsPerHarness: number;
}): Promise<Result<ListSessionsOutput, SessionListAllFailedError>> {
  const catalog = await listSessionSelectionCatalog({
    ctx: input.ctx,
    cwd: input.cwd,
    maxSessionsPerHarness: input.maxSessionsPerHarness,
  });

  if (allHarnessesFailed({ harnessIds: input.ctx.app.harnessIds, failures: catalog.failures })) {
    return Result.err(new SessionListAllFailedError({ failures: catalog.failures }));
  }

  return Result.ok({
    status: "listed",
    cwd: input.cwd,
    groups: catalog.groups,
    failures: catalog.failures,
  });
}
