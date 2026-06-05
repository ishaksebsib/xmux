import type {
  HarnessAdapterRespondInteractionInput,
  HarnessPermissionDecision,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeInteractionRequestError, OpenCodeInteractionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions } from "../types";
import {
  describeResponseError,
  expectTrueResponse,
  toResponseResult,
  type OpenCodeSdkResponse,
} from "./utils";

type OpenCodePermissionReply = "once" | "always" | "reject";

type OpenCodeInteractionSdkResponse = OpenCodeSdkResponse<boolean>;

export type OpenCodeRespondInteractionError =
  | OpenCodeInteractionRequestError
  | OpenCodeInteractionResponseError;

function toOpenCodePermissionReply(decision: HarnessPermissionDecision): OpenCodePermissionReply {
  switch (decision) {
    case "allow_once":
      return "once";
    case "allow_always":
      return "always";
    case "reject":
      return "reject";
  }
}

function toInteractionResponseError(args: {
  readonly status: number;
  readonly detail?: unknown;
  readonly reason: string;
}): OpenCodeInteractionResponseError {
  return new OpenCodeInteractionResponseError({
    status: args.status,
    detail: args.detail === undefined ? undefined : describeResponseError(args.detail),
    reason: args.reason,
  });
}

async function sendInteractionResponse(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterRespondInteractionInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<OpenCodeInteractionSdkResponse, OpenCodeInteractionRequestError>> {
  return Result.tryPromise({
    try: async () => {
      if (input.response.kind === "permission") {
        return await runtime.client.permission.reply(
          {
            requestID: input.response.requestId,
            directory: input.cwd,
            workspace: input.adapterOptions.workspace,
            reply: toOpenCodePermissionReply(input.response.decision),
            message: input.response.message,
          },
          { signal: input.signal },
        );
      }

      if (input.response.reject === true) {
        return await runtime.client.question.reject(
          {
            requestID: input.response.requestId,
            directory: input.cwd,
            workspace: input.adapterOptions.workspace,
          },
          { signal: input.signal },
        );
      }

      return await runtime.client.question.reply(
        {
          requestID: input.response.requestId,
          directory: input.cwd,
          workspace: input.adapterOptions.workspace,
          answers: input.response.answers?.map((answer) => [...answer]) ?? [],
        },
        { signal: input.signal },
      );
    },
    catch: (cause) => new OpenCodeInteractionRequestError({ cause }),
  });
}

/** Responds to an OpenCode permission/question request. */
export async function respondInteraction(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterRespondInteractionInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<void, OpenCodeRespondInteractionError>> {
  return Result.gen(async function* () {
    const response = yield* Result.await(sendInteractionResponse(runtime, input));

    const succeeded = yield* toResponseResult({
      response,
      toError: toInteractionResponseError,
      failureReason: "OpenCode interaction response failed",
      missingReason: "OpenCode interaction response returned no success confirmation",
    });

    return expectTrueResponse({
      value: succeeded,
      status: response.response?.status ?? 0,
      reason: "OpenCode interaction response returned no success confirmation",
      toError: toInteractionResponseError,
    });
  });
}
