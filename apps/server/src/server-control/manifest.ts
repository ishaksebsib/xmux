import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { API_VERSION, SERVER_MANIFEST_VERSION } from "../contracts/constants";
import { SERVER_PACKAGE_VERSION } from "./constants";
import { ServerControlEndpoint } from "../contracts/control";
import { ServerManifest, ServerOwnerMetadata } from "../contracts/manifest";
import {
  isoTimestampFromString,
  processIdFromNumber,
  type ManifestPath,
  type ProcessId,
  type SessionId,
} from "../contracts/primitives";
import { ManifestError } from "../errors";
import { HostRuntime } from "../platform/host";
import type { ServerRuntimePaths } from "./paths";

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeManifest = Schema.decodeUnknownOption(ServerManifest);

type ParseManifestResult =
  | { readonly _tag: "Valid"; readonly manifest: ServerManifest }
  | { readonly _tag: "Invalid"; readonly reason: "invalid_json" | "invalid_manifest" };

/** Public defensive manifest read result for local discovery callers. */
export type ServerManifestReadResult =
  | { readonly _tag: "NoManifest" }
  | { readonly _tag: "InvalidManifest"; readonly reason: "invalid_json" | "invalid_manifest" }
  | { readonly _tag: "ValidManifest"; readonly manifest: ServerManifest };

/** Manifest ownership tracks only the file this process is allowed to remove. */
export interface ManifestOwnership {
  readonly path: ManifestPath;
  readonly pid: ProcessId;
  readonly sessionId: SessionId;
}

/** Manifest creation input is explicit to keep process metadata at the shell edge. */
export interface CreateManifestInput {
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly sessionId: SessionId;
  readonly pid: ProcessId;
  readonly executablePath: string;
  readonly owner?: ServerOwnerMetadata;
}

export interface AcquireManifestOwnershipInput {
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly sessionId: SessionId;
  readonly owner?: ServerOwnerMetadata;
}

const parseServerManifestResult = (raw: string): ParseManifestResult => {
  const json = decodeUnknownJsonOption(raw);
  if (Option.isNone(json)) return { _tag: "Invalid", reason: "invalid_json" };
  const decoded = decodeManifest(json.value);
  if (Option.isNone(decoded)) return { _tag: "Invalid", reason: "invalid_manifest" };
  return { _tag: "Valid", manifest: decoded.value };
};

/** Invalid manifests return null so discovery never crashes the CLI. */
export const parseServerManifest = (raw: string): ServerManifest | null => {
  const result = parseServerManifestResult(raw);
  return result._tag === "Valid" ? result.manifest : null;
};

/** Serialize through one helper so manifest files remain stable for snapshots. */
export const serializeServerManifest = (manifest: ServerManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;

/** Build the active-server manifest for the local control endpoint. */
export const createServerManifest = (input: CreateManifestInput): ServerManifest =>
  ServerManifest.make({
    version: SERVER_MANIFEST_VERSION,
    protocolVersion: API_VERSION,
    pid: input.pid,
    sessionId: input.sessionId,
    startedAt: isoTimestampFromString(input.startedAt.toISOString()),
    configPath: input.paths.configPath,
    stateDir: input.paths.stateDir,
    scopeId: input.paths.scopeId,
    endpoint: ServerControlEndpoint.make({
      kind: "unix-socket",
      path: input.paths.controlEndpoint.path,
    }),
    owner:
      input.owner ??
      ServerOwnerMetadata.make({
        client: "server",
        version: SERVER_PACKAGE_VERSION,
        executablePath: input.executablePath,
      }),
  });

/** Read manifests defensively because the file is only discovery metadata. */
export const readServerManifestResult = (
  manifestPath: ManifestPath | string,
): Effect.Effect<ServerManifestReadResult, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(manifestPath).pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.fail(
              ManifestError.make({
                operation: "read",
                path: manifestPath,
                message: `Failed to read server manifest: ${manifestPath}`,
                cause: error,
              }),
            ),
      ),
    );
    if (raw === null) return { _tag: "NoManifest" };
    const parsed = parseServerManifestResult(raw);
    if (parsed._tag === "Valid") {
      return { _tag: "ValidManifest", manifest: parsed.manifest };
    }
    yield* Effect.logWarning("ignoring invalid server manifest", {
      manifestPath,
      reason: parsed.reason,
    });
    return { _tag: "InvalidManifest", reason: parsed.reason };
  });

/** Read manifests defensively because the file is only discovery metadata. */
export const readServerManifest = (
  manifestPath: ManifestPath | string,
): Effect.Effect<ServerManifest | null, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const result = yield* readServerManifestResult(manifestPath);
    return result._tag === "ValidManifest" ? result.manifest : null;
  });

/** Write owner-only manifests so local discovery metadata does not leak paths. */
export const writeServerManifest = (
  manifestPath: ManifestPath | string,
  manifest: ServerManifest,
): Effect.Effect<void, ManifestError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directory = pathService.dirname(manifestPath);

    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
      Effect.mapError((cause) =>
        ManifestError.make({
          operation: "write",
          path: manifestPath,
          message: `Failed to create manifest directory: ${directory}`,
          cause,
        }),
      ),
    );
    yield* fs
      .writeFileString(manifestPath, serializeServerManifest(manifest), {
        mode: 0o600,
      })
      .pipe(
        Effect.mapError((cause) =>
          ManifestError.make({
            operation: "write",
            path: manifestPath,
            message: `Failed to write server manifest: ${manifestPath}`,
            cause,
          }),
        ),
      );
    yield* fs.chmod(manifestPath, 0o600).pipe(
      Effect.mapError((cause) =>
        ManifestError.make({
          operation: "write",
          path: manifestPath,
          message: `Failed to secure server manifest: ${manifestPath}`,
          cause,
        }),
      ),
    );
  });

/** Remove manifest files only after callers establish stale or owned status. */
export const removeServerManifest = (
  manifestPath: ManifestPath | string,
): Effect.Effect<void, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(manifestPath, { force: true }).pipe(
      Effect.mapError((cause) =>
        ManifestError.make({
          operation: "remove",
          path: manifestPath,
          message: `Failed to remove server manifest: ${manifestPath}`,
          cause,
        }),
      ),
    );
  });

/** Remove only the manifest owned by this process/session pair. */
export const removeServerManifestIfOwnedBy = (input: {
  readonly manifestPath: ManifestPath | string;
  readonly pid: ProcessId;
  readonly sessionId: SessionId;
}): Effect.Effect<void, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const manifest = yield* readServerManifest(input.manifestPath);
    if (manifest?.pid !== input.pid || manifest.sessionId !== input.sessionId) return;
    yield* removeServerManifest(input.manifestPath);
  });

/** Acquire manifest ownership as a scoped resource to guarantee cleanup. */
export const acquireManifestOwnership = Effect.fn("server.acquireManifestOwnership")(function* (
  input: AcquireManifestOwnershipInput,
) {
  const host = yield* HostRuntime;
  const manifest = createServerManifest({
    ...input,
    pid: processIdFromNumber(host.pid),
    executablePath: host.executablePath,
  });

  return yield* Effect.acquireRelease(
    writeServerManifest(input.paths.manifestPath, manifest).pipe(
      Effect.map(
        (): ManifestOwnership => ({
          path: input.paths.manifestPath,
          pid: processIdFromNumber(host.pid),
          sessionId: input.sessionId,
        }),
      ),
    ),
    (ownership) =>
      removeServerManifestIfOwnedBy({
        manifestPath: ownership.path,
        pid: ownership.pid,
        sessionId: ownership.sessionId,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("failed to remove server manifest", { error }),
        ),
        Effect.ignore,
      ),
  );
});
