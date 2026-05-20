import type { SessionRecord } from "../../store";
import { NewCommandHarnessNotConfiguredError } from "./errors";
import type { CreateSessionForThreadError } from "./service";

export function formatNewSessionSuccess(record: SessionRecord): string {
  const title = record.title ? ` (${record.title})` : "";
  return `Created ${record.ref.harnessId} session ${record.ref.sessionId}${title}.`;
}

export function formatNewSessionFailure(error: CreateSessionForThreadError): string {
  if (NewCommandHarnessNotConfiguredError.is(error)) {
    return error.message;
  }

  return `Failed to create session: ${error.message}`;
}
