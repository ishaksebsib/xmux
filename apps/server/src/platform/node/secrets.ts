import { SecretResolver } from "../../config/resolve-secrets";

/** Secret resolver backed by Effect ConfigProvider (env in production, overridable in tests). */
export const nodeSecretResolverLayer = SecretResolver.layer;
