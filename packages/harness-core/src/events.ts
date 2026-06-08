import type {
  HarnessAdapterObject,
  HarnessModelRef,
  HarnessThinkingLevel,
  HarnessTokenUsage,
  HarnessToolOutput,
  SessionRef,
} from "./contracts";

export type HarnessRunReason = "stop" | "length" | "tool_use" | "error" | "aborted";

export type HarnessMessageRole = "user" | "assistant" | "tool" | "system";

export type HarnessContentKind = "text" | "reasoning" | "tool_input" | "compaction" | "structured";

interface HarnessPromptEventBase<
  THarnessId extends string,
  TAdapterData extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly adapterData?: TAdapterData;
}

export type HarnessRunEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "run";
      readonly phase: "started";
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "run";
      readonly phase: "completed";
      readonly reason?: Exclude<HarnessRunReason, "error" | "aborted">;
      readonly usage?: HarnessTokenUsage;
      readonly cost?: number;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "run";
      readonly phase: "failed";
      readonly reason: "error";
      readonly error: unknown;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "run";
      readonly phase: "aborted";
      readonly reason: "aborted";
      readonly error?: unknown;
    });

export type HarnessTurnEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "turn";
      readonly phase: "started";
      readonly turnId?: string;
      readonly messageId?: string;
      readonly agent?: string;
      readonly model?: HarnessModelRef;
      readonly thinking?: HarnessThinkingLevel;
      readonly snapshot?: string;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "turn";
      readonly phase: "completed";
      readonly turnId?: string;
      readonly messageId?: string;
      readonly finish?: string;
      readonly usage?: HarnessTokenUsage;
      readonly cost?: number;
      readonly snapshot?: string;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "turn";
      readonly phase: "failed";
      readonly turnId?: string;
      readonly messageId?: string;
      readonly error: unknown;
    });

export interface HarnessMessageEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> extends HarnessPromptEventBase<THarnessId, TAdapterData> {
  readonly type: "message";
  readonly phase: "started" | "updated" | "completed" | "removed";
  readonly role: HarnessMessageRole;
  readonly messageId?: string;
}

export type HarnessContentEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "content";
      readonly phase: "started";
      readonly kind: HarnessContentKind;
      readonly messageId?: string;
      readonly partId?: string;
      readonly index?: number;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "content";
      readonly phase: "delta";
      readonly kind: HarnessContentKind;
      readonly delta: string;
      readonly messageId?: string;
      readonly partId?: string;
      readonly index?: number;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "content";
      readonly phase: "completed";
      readonly kind: HarnessContentKind;
      readonly text: string;
      readonly messageId?: string;
      readonly partId?: string;
      readonly index?: number;
    });

export type HarnessToolEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "input_started";
      readonly callId: string;
      readonly name?: string;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "input_delta";
      readonly callId: string;
      readonly delta: string;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "input_completed";
      readonly callId: string;
      readonly input: unknown;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "called";
      readonly callId: string;
      readonly name: string;
      readonly input: unknown;
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "progress";
      readonly callId: string;
      readonly output?: readonly HarnessToolOutput[];
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "completed";
      readonly callId: string;
      readonly output: readonly HarnessToolOutput[];
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "tool";
      readonly phase: "failed";
      readonly callId: string;
      readonly error: unknown;
    });

export type HarnessInteractionEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "interaction";
      readonly kind: "permission" | "question";
      readonly phase: "requested";
      readonly requestId: string;
      readonly prompt: string;
      readonly title?: string;
      readonly description?: string;
      readonly metadata?: unknown;
      readonly permission?: {
        readonly name?: string;
        readonly patterns?: readonly string[];
        readonly tool?: {
          readonly callId?: string;
          readonly messageId?: string;
          readonly name?: string;
        };
        readonly allowAlways?: boolean;
      };
      readonly question?: {
        readonly questions: readonly {
          readonly header?: string;
          readonly question: string;
          readonly options?: readonly {
            readonly label: string;
            readonly description?: string;
          }[];
          readonly multiple?: boolean;
          readonly custom?: boolean;
        }[];
      };
    })
  | (HarnessPromptEventBase<THarnessId, TAdapterData> & {
      readonly type: "interaction";
      readonly kind: "permission" | "question";
      readonly phase: "answered" | "rejected";
      readonly requestId: string;
    });

export interface HarnessQueueEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> extends HarnessPromptEventBase<THarnessId, TAdapterData> {
  readonly type: "queue";
  readonly steeringCount: number;
  readonly followUpCount: number;
}

export interface HarnessRetryEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> extends HarnessPromptEventBase<THarnessId, TAdapterData> {
  readonly type: "retry";
  readonly attempt: number;
  readonly maxAttempts?: number;
  readonly error?: unknown;
}

export interface HarnessNativeEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly type: "native";
  readonly ref: SessionRef<THarnessId>;
  readonly adapterData: TAdapterData;
}

export type HarnessPromptEvent<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> =
  | HarnessRunEvent<THarnessId, TAdapterData>
  | HarnessTurnEvent<THarnessId, TAdapterData>
  | HarnessMessageEvent<THarnessId, TAdapterData>
  | HarnessContentEvent<THarnessId, TAdapterData>
  | HarnessToolEvent<THarnessId, TAdapterData>
  | HarnessInteractionEvent<THarnessId, TAdapterData>
  | HarnessQueueEvent<THarnessId, TAdapterData>
  | HarnessRetryEvent<THarnessId, TAdapterData>
  | HarnessNativeEvent<THarnessId, TAdapterData>;
