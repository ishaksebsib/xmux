import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  API_VERSION,
  SERVER_MANIFEST_VERSION,
  SERVER_PACKAGE_VERSION,
} from "../contracts/constants";
import { ManifestEndpoint, ServerManifest, ServerOwnerMetadata } from "../contracts/manifest";
import { ManifestError } from "../errors";
import type { ServerRuntimePaths } from "./paths";

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeManifest = Schema.decodeUnknownOption(ServerManifest);

/** Manifest ownership tracks only the file this process is allowed to remove. */
export interface ManifestOwnership {
  readonly path: string;
  readonly pid: number;
  readonly sessionId: string;
}

/** Manifest creation input is explicit to keep process metadata at the shell edge. */
export interface CreateManifestInput {
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly sessionId: string;
  readonly owner?: ServerOwnerMetadata;
}

/** Invalid manifests return null so discovery never crashes the CLI. */
export const parseServerManifest = (raw: string): ServerManifest | null => {
  const json = decodeUnknownJsonOption(raw);
  if (Option.isNone(json)) return null;
  const decoded = decodeManifest(json.value);
  if (Option.isNone(decoded)) return null;
  return decoded.value;
};

/** Serialize through one helper so manifest files remain stable for snapshots. */
export const serializeServerManifest = (manifest: ServerManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;

/** Build the active-server manifest for the local control endpoint. */
export const createServerManifest = (input: CreateManifestInput): ServerManifest =>
  ServerManifest.make({
    version: SERVER_MANIFEST_VERSION,
    protocolVersion: API_VERSION,
    pid: process.pid,
    sessionId: input.sessionId,
    startedAt: input.startedAt.toISOString(),
    configPath: input.paths.configPath,
    stateDir: input.paths.stateDir,
    scopeId: input.paths.scopeId,
    endpoint: ManifestEndpoint.make({
      kind: "unix-socket",
      path: input.paths.controlEndpoint.path,
    }),
    owner:
      input.owner ??
      ServerOwnerMetadata.make({
        client: "server",
        version: SERVER_PACKAGE_VERSION,
        executablePath: process.argv[1] ?? process.execPath,
      }),
  });

/** Read manifests defensively because the file is only discovery metadata. */
export const readServerManifest = (
  manifestPath: string,
): Effect.Effect<ServerManifest | null, ManifestError, FileSystem.FileSystem> =>
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
    if (raw === null) return null;
    return parseServerManifest(raw);
  });

/** Write owner-only manifests so local discovery metadata does not leak paths. */
export const writeServerManifest = (
  manifestPath: string,
  manifest: ServerManifest,
): Effect.Effect<void, ManifestError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directory = pathService.dirname(manifestPath);

    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
      Effect.mapError(
        (cause) =>
          ManifestError.make({
            operation: "write",
            path: manifestPath,
            message: `Failed to create manifest directory: ${directory}`,
            cause,
          }),
      ),
    );
    yield* fs.writeFileString(manifestPath, serializeServerManifest(manifest), {
      mode: 0o600,
    }).pipe(
      Effect.mapError(
        (cause) =>
          ManifestError.make({
            operation: "write",
            path: manifestPath,
            message: `Failed to write server manifest: ${manifestPath}`,
            cause,
          }),
      ),
    );
    yield* fs.chmod(manifestPath, 0o600).pipe(
      Effect.mapError(
        (cause) =>
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
  manifestPath: string,
): Effect.Effect<void, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(manifestPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
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
  readonly manifestPath: string;
  readonly pid: number;
  readonly sessionId: string;
}): Effect.Effect<void, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const manifest = yield* readServerManifest(input.manifestPath);
    if (manifest?.pid !== input.pid || manifest.sessionId !== input.sessionId) return;
    yield* removeServerManifest(input.manifestPath);
  });

/** Acquire manifest ownership as a scoped resource to guarantee cleanup. */
export const acquireManifestOwnership = Effect.fn("server.acquireManifestOwnership")(function* (
  input: CreateManifestInput,
) {
  const manifest = createServerManifest(input);

  return yield* Effect.acquireRelease(
    writeServerManifest(input.paths.manifestPath, manifest).pipe(
      Effect.map(
        (): ManifestOwnership => ({
          path: input.paths.manifestPath,
          pid: process.pid,
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
