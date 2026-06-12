type EventOverrides = {
  readonly id?: string;
  readonly properties?: Record<string, unknown>;
};

let eventIndex = 0;

const provider = { executed: true, metadata: {} } as const;

export function event<TType extends string, TProperties extends Record<string, unknown>>(
  type: TType,
  properties: TProperties,
  overrides: EventOverrides = {},
) {
  eventIndex += 1;
  return {
    id: overrides.id ?? `evt_${eventIndex}`,
    type,
    properties: { ...properties, ...overrides.properties },
  };
}

export function wrapped<TValue>(payload: TValue): { readonly payload: TValue } {
  return { payload };
}

export function nextStepStarted(
  sessionID: string,
  overrides: Record<string, unknown> = {},
) {
  return event("session.next.step.started", {
    timestamp: 1,
    sessionID,
    agent: "build",
    model: { providerID: "provider-1", id: "model-1" },
    ...overrides,
  });
}

export function nextStepEnded(sessionID: string, overrides: Record<string, unknown> = {}) {
  return event("session.next.step.ended", {
    timestamp: 2,
    sessionID,
    finish: "stop",
    cost: 0.01,
    tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 },
    ...overrides,
  });
}

export function sessionIdle(sessionID: string) {
  return event("session.idle", { sessionID });
}

export function nextTextSequence(sessionID: string, text: string) {
  return [
    event("session.next.text.started", { sessionID, timestamp: 10 }),
    event("session.next.text.delta", { sessionID, timestamp: 11, delta: text }),
    event("session.next.text.ended", { sessionID, timestamp: 12, text }),
  ];
}

export function nextReasoningSequence(sessionID: string, reasoningID: string, text: string) {
  return [
    event("session.next.reasoning.started", { sessionID, timestamp: 20, reasoningID }),
    event("session.next.reasoning.delta", { sessionID, timestamp: 21, reasoningID, delta: text }),
    event("session.next.reasoning.ended", { sessionID, timestamp: 22, reasoningID, text }),
  ];
}

export function nextToolSuccessSequence(
  sessionID: string,
  callID: string,
  name: string,
  input: unknown,
  output: string,
) {
  const rawInput = JSON.stringify(input);
  return [
    event("session.next.tool.input.started", { sessionID, timestamp: 30, callID, name }),
    event("session.next.tool.input.delta", { sessionID, timestamp: 31, callID, delta: rawInput }),
    event("session.next.tool.input.ended", { sessionID, timestamp: 32, callID, text: rawInput }),
    event("session.next.tool.called", { sessionID, timestamp: 33, callID, tool: name, input, provider }),
    event("session.next.tool.success", {
      sessionID,
      timestamp: 34,
      callID,
      content: [{ type: "text", text: output }],
      structured: {},
      provider,
    }),
  ];
}

export function nextToolFailedSequence(
  sessionID: string,
  callID: string,
  name: string,
  input: unknown,
  error: unknown,
) {
  const rawInput = JSON.stringify(input);
  return [
    event("session.next.tool.input.started", { sessionID, timestamp: 40, callID, name }),
    event("session.next.tool.input.delta", { sessionID, timestamp: 41, callID, delta: rawInput }),
    event("session.next.tool.input.ended", { sessionID, timestamp: 42, callID, text: rawInput }),
    event("session.next.tool.called", { sessionID, timestamp: 43, callID, tool: name, input, provider }),
    event("session.next.tool.failed", { sessionID, timestamp: 44, callID, error, provider }),
  ];
}

export function permissionAsked(sessionID: string, overrides: Record<string, unknown> = {}) {
  return event("permission.asked", {
    id: "permission-1",
    sessionID,
    permission: "bash",
    patterns: ["pnpm test"],
    metadata: {},
    always: [],
    ...overrides,
  });
}

export function questionAsked(sessionID: string, overrides: Record<string, unknown> = {}) {
  return event("question.asked", {
    id: "question-1",
    sessionID,
    questions: [
      {
        header: "Confirm",
        question: "Continue?",
        options: [{ label: "Yes", description: "Proceed" }],
        multiple: false,
        custom: false,
      },
    ],
    ...overrides,
  });
}
