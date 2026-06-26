import { Option } from "effect";

export type ParseJsonPayloadResult<A, TInvalidReason extends string> =
  | { readonly _tag: "Valid"; readonly value: A }
  | { readonly _tag: "Invalid"; readonly reason: "invalid_json" | TInvalidReason };

export const parseJsonPayloadResult = <A, TInvalidReason extends string>(input: {
  readonly raw: string;
  readonly decodeJson: (raw: string) => Option.Option<unknown>;
  readonly decodePayload: (value: unknown) => Option.Option<A>;
  readonly invalidPayloadReason: TInvalidReason;
}): ParseJsonPayloadResult<A, TInvalidReason> => {
  const json = input.decodeJson(input.raw);
  if (Option.isNone(json)) return { _tag: "Invalid", reason: "invalid_json" };
  const decoded = input.decodePayload(json.value);
  if (Option.isNone(decoded)) return { _tag: "Invalid", reason: input.invalidPayloadReason };
  return { _tag: "Valid", value: decoded.value };
};
