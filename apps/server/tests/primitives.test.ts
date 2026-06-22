import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  BaseUrl,
  EnvironmentVariableName,
  IsoTimestamp,
  Port,
  ProcessId,
  ResolvedPath,
  ScopeId,
  SessionId,
  configPathFromString,
  processIdFromNumber,
  scopeIdFromString,
} from "../src/contracts/primitives";

const decodePort = Schema.decodeUnknownSync(Port);
const decodePid = Schema.decodeUnknownSync(ProcessId);
const decodeTimestamp = Schema.decodeUnknownSync(IsoTimestamp);
const decodeEnvName = Schema.decodeUnknownSync(EnvironmentVariableName);
const decodeUrl = Schema.decodeUnknownSync(BaseUrl);
const decodePath = Schema.decodeUnknownSync(ResolvedPath);
const decodeScopeId = Schema.decodeUnknownSync(ScopeId);
const decodeSessionId = Schema.decodeUnknownSync(SessionId);

describe("domain primitives", () => {
  it.effect("rejects invalid ports", () =>
    Effect.sync(() => {
      assert.throws(() => decodePort(0));
      assert.throws(() => decodePort(65_536));
      assert.throws(() => decodePort(1.5));
      assert.strictEqual(decodePort(8080), 8080);
    }),
  );

  it.effect("rejects invalid process ids", () =>
    Effect.sync(() => {
      assert.throws(() => decodePid(0));
      assert.throws(() => decodePid(Number.MAX_SAFE_INTEGER + 1));
      assert.strictEqual(processIdFromNumber(process.pid), process.pid);
    }),
  );

  it.effect("rejects invalid timestamps, env names, URLs, and empty ids", () =>
    Effect.sync(() => {
      assert.throws(() => decodeTimestamp("not-a-date"));
      assert.throws(() => decodeEnvName("1BAD"));
      assert.throws(() => decodeUrl("not a url"));
      assert.throws(() => decodePath("relative/path"));
      assert.throws(() => decodeScopeId(""));
      assert.throws(() => decodeSessionId(""));

      assert.strictEqual(scopeIdFromString("scope"), "scope");
      assert.strictEqual(configPathFromString("/tmp/xmux/config.jsonc"), "/tmp/xmux/config.jsonc");
    }),
  );
});
