import type { Harness, HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createSessionFromCommand, parseCreateSessionCommand } from "./commands/new";
import type { XmuxManagedSession, XmuxSessionId } from "./session";
import type { XmuxThreadState } from "./thread-state";
import type { XmuxConfig } from "./config";

type XmuxMessageLike = {
  readonly text: string;
};

export type XmuxThreadLike = {
  readonly state: Promise<XmuxThreadState | null>;
  post(message: string): Promise<unknown>;
  setState(
    newState: XmuxThreadState,
    options?: {
      replace?: boolean;
    },
  ): Promise<void>;
  subscribe(): Promise<void>;
};

export interface XmuxRuntime<TAdapters extends HarnessAdapterDefinitions<TAdapters>> {
  readonly config: XmuxConfig;
  readonly harness: Harness<TAdapters>;
  readonly harnessIds: readonly Extract<keyof TAdapters, string>[];
  readonly sessions: Map<XmuxSessionId, XmuxManagedSession<TAdapters>>;
}

function createHelpMessage(): string {
  return [
    "xmux is running.",
    "",
    "Available command:",
    "- `/new <harnessId>`",
    "- `/new <harnessId> <title>`",
  ].join("\n");
}

export function createXmuxRuntime<TAdapters extends HarnessAdapterDefinitions<TAdapters>>(args: {
  readonly config: XmuxConfig;
  readonly harness: Harness<TAdapters>;
}): XmuxRuntime<TAdapters> {
  return {
    config: args.config,
    harness: args.harness,
    harnessIds: args.harness.harnessIds,
    sessions: new Map<XmuxSessionId, XmuxManagedSession<TAdapters>>(),
  };
}

export async function handleXmuxIncomingMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
>(args: {
  readonly runtime: XmuxRuntime<TAdapters>;
  readonly message: XmuxMessageLike;
  readonly thread: XmuxThreadLike;
}): Promise<void> {
  const command = parseCreateSessionCommand(args.message.text);
  const threadState = await args.thread.state;

  if (command?.kind === "new") {
    await createSessionFromCommand({
      command,
      runtime: args.runtime,
      thread: args.thread,
      threadState,
    });
    return;
  }

  if (threadState?.session) {
    await args.thread.post(
      `Active xmux session \`${threadState.session.xmuxSessionId}\` is attached, but prompting is not implemented yet.`,
    );
    return;
  }

  await args.thread.post(createHelpMessage());
}
