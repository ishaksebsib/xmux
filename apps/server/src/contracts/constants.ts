import packageJson from "../../package.json" with { type: "json" };

/** Version shared by the local HTTP API contract and versioned response envelopes. */
export const API_VERSION = 1;

/** Manifest file version gates future shape changes without guessing. */
export const SERVER_MANIFEST_VERSION = 1;

/** Package version is published into manifests so users can identify the server binary. */
export const SERVER_PACKAGE_VERSION = packageJson.version;
