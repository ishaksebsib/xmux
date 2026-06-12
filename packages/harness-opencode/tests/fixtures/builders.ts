import type { Model, Provider, Session } from "@opencode-ai/sdk/v2";

export function nativeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    slug: "session-1-slug",
    projectID: "project-1",
    directory: process.cwd(),
    title: "OpenCode session",
    version: "1.0.0",
    time: { created: 1, updated: 1 },
    ...overrides,
  } as Session;
}

export function nativeModel(overrides: Partial<Model> = {}): Model {
  const id = overrides.id ?? "model-1";
  const providerID = overrides.providerID ?? "provider-1";

  return {
    id,
    providerID,
    api: { id, url: "", npm: "" },
    family: "family-1",
    name: `${id} name`,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: true, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
    limit: { context: 1000, input: 900, output: 100 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: {},
    ...overrides,
  } as Model;
}

export function nativeProvider(overrides: Partial<Provider> = {}): Provider {
  const models = overrides.models ?? { "model-1": nativeModel() };

  return {
    id: "provider-1",
    name: "Provider One",
    source: "custom",
    env: [],
    options: {},
    models,
    ...overrides,
  } as Provider;
}

export function providerList(overrides: { readonly providers?: readonly Provider[] } = {}) {
  return {
    providers: overrides.providers ?? [nativeProvider()],
    default: {},
  };
}
