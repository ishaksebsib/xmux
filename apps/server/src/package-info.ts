import packageJson from "../package.json" with { type: "json" };

/** Package version is published into manifests so users can identify the server binary. */
export const SERVER_PACKAGE_VERSION = packageJson.version;
