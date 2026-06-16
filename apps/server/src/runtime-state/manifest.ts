import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  CONTROL_PROTOCOL_VERSION,
  ManifestEndpoint,
  SERVER_MANIFEST_VERSION,
  ServerManifest,
  ServerOwnerMetadata,
} from "../contracts/manifest";
import { ManifestError } from "../errors";
import type { ServerRuntimePaths } from "./paths";
import { isPidAlive } from "./pid";

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeManifest = Schema.decodeUnknownOption(ServerManifest);

/** Manifest ownership tracks only the file this process is allowed to remove. */
export interface ManifestOwnership {
  readonly path: string;
  readonly pid: number;
  readonly wroteManifest: boolean;
}

/** Manifest creation input is explicit to keep process metadata at the shell edge. */
export interface CreateManifestInput {
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly owner?: ServerOwnerMetadata;
}

/** Invalid or stale manifests return null so discovery never crashes the CLI. */
export const parseServerManifest = (raw: string): ServerManifest | null => {
  const json = decodeUnknownJsonOption(raw);
  if (Option.isNone(json)) return null;
  const decoded = decodeManifest(json.value);
  if (Option.isNone(decoded)) return null;
  if (!isPidAlive(decoded.value.pid)) return null;
  return decoded.value;
};

/** Serialize through one helper so manifest files remain stable for snapshots. */
export const serializeServerManifest = (manifest: ServerManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;

/** Build a manifest only for real local control endpoints. */
export const createServerManifest = (input: CreateManifestInput): ServerManifest | null => {
  if (input.paths.controlEndpoint.kind !== "unix-socket") return null;

  return new ServerManifest({
    version: SERVER_MANIFEST_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    pid: process.pid,
    startedAt: input.startedAt.toISOString(),
    configPath: input.paths.configPath,
    stateDir: input.paths.stateDir,
    scopeId: input.paths.scopeId,
    endpoint: new ManifestEndpoint({
      kind: "unix-socket",
      path: input.paths.controlEndpoint.path,
    }),
    owner:
      input.owner ??
      new ServerOwnerMetadata({
        client: "server",
        version: "0.0.0",
        executablePath: process.argv[1] ?? process.execPath,
      }),
  });
};

/** Read manifests defensively because the file is only discovery metadata. */
export const readServerManifest = (
  manifestPath: string,
): Effect.Effect<ServerManifest | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(manifestPath)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
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
          new ManifestError({
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
          new ManifestError({
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
          new ManifestError({
            operation: "write",
            path: manifestPath,
            message: `Failed to secure server manifest: ${manifestPath}`,
            cause,
          }),
      ),
    );
  });

/** Remove only the manifest owned by this PID to avoid deleting another server. */
export const removeServerManifestIfOwnedBy = (input: {
  readonly manifestPath: string;
  readonly pid: number;
}): Effect.Effect<void, ManifestError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const manifest = yield* readServerManifest(input.manifestPath);
    if (manifest?.pid !== input.pid) return;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(input.manifestPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ManifestError({
            operation: "remove",
            path: input.manifestPath,
            message: `Failed to remove server manifest: ${input.manifestPath}`,
            cause,
          }),
      ),
    );
  });

/** Acquire manifest ownership as a scoped resource to guarantee cleanup. */
export const acquireManifestOwnership = Effect.fn("server.acquireManifestOwnership")(function* (
  input: CreateManifestInput,
) {
  const manifest = createServerManifest(input);
  if (manifest === null) {
    return { path: input.paths.manifestPath, pid: process.pid, wroteManifest: false };
  }

  return yield* Effect.acquireRelease(
    writeServerManifest(input.paths.manifestPath, manifest).pipe(
      Effect.map(
        (): ManifestOwnership => ({
          path: input.paths.manifestPath,
          pid: process.pid,
          wroteManifest: true,
        }),
      ),
    ),
    (ownership) =>
      removeServerManifestIfOwnedBy({
        manifestPath: ownership.path,
        pid: ownership.pid,
      }).pipe(Effect.ignore),
  );
});
