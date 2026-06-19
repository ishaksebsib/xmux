import packageJson from "../../package.json" with { type: "json" };

/** Version shared by the local HTTP API contract and versioned response envelopes. */
export const API_VERSION = 1;

/** Manifest file version gates future shape changes without guessing. */
export const SERVER_MANIFEST_VERSION = 1;

/** Package version is published into manifests so users can identify the server binary. */
export const SERVER_PACKAGE_VERSION = packageJson.version;

/** Stable application directory name used in platform-specific user directories. */
export const APP_DIR_NAME = "xmux";

export const DEFAULT_CONFIG_FILE_NAME = "config.jsonc";
export const DEFAULT_DB_FILE_NAME = "xmux.db";
export const LOG_DIR_NAME = "logs";
export const RUNTIME_DIR_NAME = "run";
export const SERVER_CONTROL_DIR_NAME = "server-control";

export const SERVER_MANIFEST_FILE_PREFIX = "server";
export const SERVER_SOCKET_FILE_PREFIX = "server";
export const STARTUP_LOCK_FILE_PREFIX = "startup";
export const UNIX_SOCKET_FILE_EXTENSION = "sock";
export const STARTUP_LOCK_FILE_EXTENSION = "lock";

export const XDG_CONFIG_HOME_ENV = "XDG_CONFIG_HOME";
export const XDG_STATE_HOME_ENV = "XDG_STATE_HOME";
export const XDG_RUNTIME_DIR_ENV = "XDG_RUNTIME_DIR";
