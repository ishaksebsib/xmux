import { Schema } from "effect";

export const SAFE_STATUS_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u;

export const SafeStatusReason = Schema.String.check(
  Schema.isPattern(SAFE_STATUS_REASON_PATTERN, {
    expected: "a bounded safe status reason identifier",
  }),
).pipe(Schema.brand("@xmux/server/SafeStatusReason"));
export type SafeStatusReason = typeof SafeStatusReason.Type;

const decodeSafeStatusReason = Schema.decodeUnknownSync(SafeStatusReason);
const UNKNOWN_SAFE_STATUS_REASON = decodeSafeStatusReason("unknown_error");

const taggedErrorName = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("_tag" in value)) return undefined;
  return typeof value._tag === "string" ? value._tag : undefined;
};

const safeIdentifier = (value: string | undefined): string | undefined =>
  value !== undefined && SAFE_STATUS_REASON_PATTERN.test(value) ? value : undefined;

const safeStatusReasonFromCandidate = (
  candidate: string | undefined,
): SafeStatusReason | undefined =>
  candidate === undefined ? undefined : decodeSafeStatusReason(candidate);

export const safeStatusReasonFromString = (reason: string): SafeStatusReason =>
  safeStatusReasonFromCandidate(safeIdentifier(reason)) ?? UNKNOWN_SAFE_STATUS_REASON;

export const sanitizeStatusReason = (reason: string | undefined): SafeStatusReason | undefined =>
  reason === undefined ? undefined : safeStatusReasonFromString(reason);

export const safeStatusReasonFromUnknown = (cause: unknown): SafeStatusReason => {
  const tag = safeStatusReasonFromCandidate(safeIdentifier(taggedErrorName(cause)));
  if (tag !== undefined) return tag;

  if (cause instanceof Error) {
    const constructorName = safeStatusReasonFromCandidate(safeIdentifier(cause.constructor.name));
    if (constructorName !== undefined) return constructorName;

    const errorName = safeStatusReasonFromCandidate(safeIdentifier(cause.name));
    if (errorName !== undefined) return errorName;
  }

  return UNKNOWN_SAFE_STATUS_REASON;
};

export const ServerOrchestratorState = Schema.Literals([
  "not_started",
  "disabled",
  "starting",
  "running",
  "failed",
  "stopping",
  "stopped",
]);
export type ServerOrchestratorState = typeof ServerOrchestratorState.Type;

export const ServerOrchestratorActivationState = Schema.Literals([
  "disabled",
  "enabled",
  "invalid",
  "unknown",
]);
export type ServerOrchestratorActivationState = typeof ServerOrchestratorActivationState.Type;

export const ServerChatAdapterRuntimeState = Schema.Literals([
  "configured",
  "opening",
  "starting",
  "active",
  "failed",
  "closing",
  "stopped",
]);
export type ServerChatAdapterRuntimeState = typeof ServerChatAdapterRuntimeState.Type;

export const ServerHarnessAdapterRuntimeState = Schema.Literals([
  "configured_lazy",
  "opening",
  "opened",
  "failed",
  "closing",
  "closed",
]);
export type ServerHarnessAdapterRuntimeState = typeof ServerHarnessAdapterRuntimeState.Type;

export class ServerChatAdapterStatus extends Schema.Class<ServerChatAdapterStatus>(
  "ServerChatAdapterStatus",
)({
  id: Schema.String,
  state: ServerChatAdapterRuntimeState,
  reason: Schema.optionalKey(SafeStatusReason),
}) {}

export class ServerHarnessAdapterStatus extends Schema.Class<ServerHarnessAdapterStatus>(
  "ServerHarnessAdapterStatus",
)({
  id: Schema.String,
  state: ServerHarnessAdapterRuntimeState,
  reason: Schema.optionalKey(SafeStatusReason),
}) {}

export class ServerOrchestratorStatusSnapshot extends Schema.Class<ServerOrchestratorStatusSnapshot>(
  "ServerOrchestratorStatusSnapshot",
)({
  state: ServerOrchestratorState,
  activation: ServerOrchestratorActivationState,
  chats: Schema.Array(ServerChatAdapterStatus),
  harnesses: Schema.Array(ServerHarnessAdapterStatus),
  reason: Schema.optionalKey(SafeStatusReason),
}) {}
