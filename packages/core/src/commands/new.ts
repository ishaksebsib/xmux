import {
  type CreateSessionInput,
  type CreateSessionInputFor,
  type HarnessAdapterDefinitions,
} from "@xmux/harness-core";
import type { XmuxRuntime, XmuxThreadLike } from "../runtime";
import {
  createXmuxThreadState,
  resolveWorkingDirectory,
  type XmuxThreadState,
} from "../thread-state";
import {
  defineManagedSession,
  type XmuxManagedSession,
  type XmuxManagedSessionFor,
} from "../session";

type CreateSessionCommand = {
  readonly kind: "new";
  readonly harnessId: string;
  readonly title?: string;
};

function isKnownHarnessId<TAdapters extends HarnessAdapterDefinitions<TAdapters>>(
  runtime: XmuxRuntime<TAdapters>,
  harnessId: string,
): harnessId is Extract<keyof TAdapters, string> {
  return runtime.harnessIds.includes(harnessId as Extract<keyof TAdapters, string>);
}

export function parseCreateSessionCommand(text: string): CreateSessionCommand | null {
  const match = text
    .trim()
    .match(/^\/new(?:@[A-Za-z0-9_]+)?\s+(?<harnessId>[A-Za-z0-9_-]+)(?:\s+(?<title>.+))?$/i);

  if (!match?.groups?.harnessId) {
    return null;
  }

  const title = match.groups.title?.trim();

  return {
    kind: "new",
    harnessId: match.groups.harnessId,
    title: title && title.length > 0 ? title : undefined,
  };
}

function formatSessionCreatedMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
>(session: XmuxManagedSessionFor<TAdapters, THarnessId>): string {
  return [
    "Created xmux session",
    "",
    `- xmux id: \`${session.id}\``,
    `- harness: \`${session.harnessSession.ref.harnessId}\``,
    `- harness session id: \`${session.harnessSession.ref.sessionId}\``,
    `- cwd: \`${session.harnessSession.cwd}\``,
    `- delivery mode: \`${session.deliveryMode}\``,
  ].join("\n");
}

export async function createSessionFromCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
>(args: {
  readonly command: CreateSessionCommand;
  readonly runtime: XmuxRuntime<TAdapters>;
  readonly thread: XmuxThreadLike;
  readonly threadState: XmuxThreadState | null;
}): Promise<void> {
  if (!isKnownHarnessId(args.runtime, args.command.harnessId)) {
    await args.thread.post(
      `Unknown harness "${args.command.harnessId}". Available harnesses: ${args.runtime.harnessIds.join(", ") || "(none)"}`,
    );
    return;
  }

  const harnessId = args.command.harnessId;
  const created = await args.runtime.harness.createSession({
    harnessId,
    cwd: resolveWorkingDirectory(args.threadState, args.runtime.config.defaultWorkingDirectory),
    title: args.command.title,
  } as CreateSessionInputFor<TAdapters, typeof harnessId> as CreateSessionInput<TAdapters>);

  if (created.isErr()) {
    await args.thread.post(
      `Failed to create ${args.command.harnessId} session: ${created.error.message}`,
    );
    return;
  }

  const session = defineManagedSession({
    deliveryMode: args.runtime.config.deliveryMode,
    harnessSession: created.value,
  });

  args.runtime.sessions.set(session.id, session as XmuxManagedSession<TAdapters>);
  await args.thread.subscribe();
  await args.thread.setState(
    createXmuxThreadState({
      cwd: session.harnessSession.cwd,
      session: {
        xmuxSessionId: session.id,
        harnessId: session.harnessSession.ref.harnessId,
        harnessSessionId: session.harnessSession.ref.sessionId,
      },
    }),
    { replace: true },
  );
  await args.thread.post(formatSessionCreatedMessage(session));
}
