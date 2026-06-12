import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Provider, Session } from "@opencode-ai/sdk/v2";
import { nativeSession, providerList } from "./builders";

type RequestRecord = {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
  readonly headers: IncomingHttpHeaders;
};

type ForcedResponse = {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
};

type StartFakeOpenCodeServerOptions = {
  readonly sessions?: readonly Session[];
  readonly providers?: readonly Provider[];
};

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function queryToRecord(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries());
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function pathSessionID(path: string, suffix = ""): string | undefined {
  const match = path.match(new RegExp(`^/session/([^/]+)${suffix}$`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export async function startFakeOpenCodeServer(options: StartFakeOpenCodeServerOptions = {}) {
  const requests: RequestRecord[] = [];
  const sessions = new Map<string, Session>();
  for (const session of options.sessions ?? [nativeSession()]) sessions.set(session.id, session);

  let providers = providerList({ providers: options.providers });
  const forcedResponses = new Map<string, ForcedResponse>();
  const queuedEvents: unknown[] = [];
  const sseResponses = new Set<ServerResponse>();
  const requestWaiters = new Set<{
    readonly predicate: (request: RequestRecord) => boolean;
    readonly resolve: (request: RequestRecord) => void;
  }>();
  let closeStreamAfterQueuedEvents = false;

  function sendSse(response: ServerResponse, value: unknown): void {
    response.write(`data: ${JSON.stringify(value)}\n\n`);
  }

  function flushEvents(response: ServerResponse): void {
    sendSse(response, event("server.connected", {}));
    for (const queued of queuedEvents) sendSse(response, queued);
    if (closeStreamAfterQueuedEvents) response.end();
  }

  function event(type: string, properties: Record<string, unknown>) {
    return { id: `fake-${Date.now()}`, type, properties };
  }

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readRequestBody(request);
    const record = {
      method,
      path: url.pathname,
      query: queryToRecord(url),
      body,
      headers: request.headers,
    } satisfies RequestRecord;
    requests.push(record);
    for (const waiter of requestWaiters) {
      if (waiter.predicate(record)) {
        requestWaiters.delete(waiter);
        waiter.resolve(record);
      }
    }

    const forced = forcedResponses.get(routeKey(method, url.pathname));
    if (forced) {
      response.writeHead(forced.status, { "content-type": "application/json", ...forced.headers });
      response.end(forced.body === undefined ? undefined : JSON.stringify(forced.body));
      return;
    }

    if (method === "GET" && (url.pathname === "/global/event" || url.pathname === "/event")) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      sseResponses.add(response);
      response.on("close", () => sseResponses.delete(response));
      flushEvents(response);
      return;
    }

    if (method === "POST" && url.pathname === "/session") {
      const input =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const id = `session-${sessions.size + 1}`;
      const session = nativeSession({
        id,
        slug: `${id}-slug`,
        projectID: "project-1",
        directory: url.searchParams.get("directory") ?? process.cwd(),
        title: typeof input.title === "string" ? input.title : "OpenCode session",
        model:
          typeof input.model === "object" && input.model !== null
            ? (input.model as Session["model"])
            : undefined,
        workspaceID: typeof input.workspaceID === "string" ? input.workspaceID : undefined,
      });
      sessions.set(id, session);
      writeJson(response, 200, session);
      return;
    }

    if (method === "GET" && url.pathname === "/session") {
      writeJson(response, 200, [...sessions.values()]);
      return;
    }

    const getSessionID = pathSessionID(url.pathname);
    if (method === "GET" && getSessionID) {
      const session = sessions.get(getSessionID);
      writeJson(
        response,
        session ? 200 : 404,
        session ?? {
          name: "NotFoundError",
          data: { message: `Session not found: ${getSessionID}` },
        },
      );
      return;
    }

    const deleteSessionID = pathSessionID(url.pathname);
    if (method === "DELETE" && deleteSessionID) {
      sessions.delete(deleteSessionID);
      writeJson(response, 200, true);
      return;
    }

    const abortSessionID = pathSessionID(url.pathname, "/abort");
    if (method === "POST" && abortSessionID) {
      writeJson(response, 200, true);
      return;
    }

    const promptSessionID = pathSessionID(url.pathname, "/prompt_async");
    if (method === "POST" && promptSessionID) {
      response.writeHead(204);
      response.end();
      return;
    }

    if (
      method === "POST" &&
      url.pathname.startsWith("/permission/") &&
      url.pathname.endsWith("/reply")
    ) {
      writeJson(response, 200, true);
      return;
    }

    if (
      method === "POST" &&
      url.pathname.startsWith("/question/") &&
      (url.pathname.endsWith("/reply") || url.pathname.endsWith("/reject"))
    ) {
      writeJson(response, 200, true);
      return;
    }

    if (method === "GET" && url.pathname === "/config/providers") {
      writeJson(response, 200, providers);
      return;
    }

    writeJson(response, 404, {
      name: "NotFoundError",
      data: { message: `${method} ${url.pathname} not found` },
    });
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("Failed to start fake OpenCode server"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    url,
    requests,
    sessions,
    enqueueEvents: (...events: readonly unknown[]) => {
      queuedEvents.push(...events);
      for (const response of sseResponses) {
        for (const queued of events) sendSse(response, queued);
        if (closeStreamAfterQueuedEvents) response.end();
      }
    },
    closeEventStreamsAfterQueuedEvents: () => {
      closeStreamAfterQueuedEvents = true;
    },
    closeEventStreams: () => {
      for (const response of sseResponses) response.end();
      sseResponses.clear();
    },
    forceResponse: (method: string, path: string, forced: ForcedResponse) => {
      forcedResponses.set(routeKey(method, path), forced);
    },
    clearForcedResponses: () => forcedResponses.clear(),
    waitForRequest: (predicate: (request: RequestRecord) => boolean, timeoutMs = 1000) => {
      const existing = requests.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<RequestRecord>((resolve, reject) => {
        let timer: NodeJS.Timeout;
        const waiter = {
          predicate,
          resolve: (request: RequestRecord) => {
            clearTimeout(timer);
            resolve(request);
          },
        };
        timer = setTimeout(() => {
          requestWaiters.delete(waiter);
          reject(new Error("Timed out waiting for fake OpenCode request"));
        }, timeoutMs);
        requestWaiters.add(waiter);
      });
    },
    setProviderList: (nextProviders: readonly Provider[]) => {
      providers = providerList({ providers: nextProviders });
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const response of sseResponses) response.end();
        sseResponses.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export type FakeOpenCodeServer = Awaited<ReturnType<typeof startFakeOpenCodeServer>>;
