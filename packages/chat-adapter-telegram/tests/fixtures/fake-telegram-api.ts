import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import type { AddressInfo } from "node:net";
import { fakeBotInfo, telegramFile, telegramSentMessage } from "./telegram-builders";

export interface FakeTelegramRequest {
  readonly method: string;
  readonly pathname: string;
  readonly telegramMethod?: string;
  readonly body: unknown;
  readonly rawBody: Buffer;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
}

export interface FakeTelegramApi {
  readonly token: string;
  readonly url: string;
  readonly requests: readonly FakeTelegramRequest[];
  enqueueUpdate(update: Record<string, unknown>): void;
  setMethodError(
    method: string,
    error: { readonly error_code: number; readonly description: string },
  ): void;
  setMethodResult(method: string, result: unknown): void;
  setFile(path: string, content: Uint8Array | string, init?: { readonly contentType?: string }): void;
  waitForMethod(
    method: string,
    options?: { readonly timeoutMs?: number; readonly afterIndex?: number },
  ): Promise<FakeTelegramRequest>;
  waitForNextMethod(method: string, options?: { readonly timeoutMs?: number }): Promise<FakeTelegramRequest>;
  close(): Promise<void>;
}

interface PendingGetUpdates {
  readonly response: ServerResponse;
  readonly request: FakeTelegramRequest;
}

export async function startFakeTelegramApi(
  options: { readonly token?: string } = {},
): Promise<FakeTelegramApi> {
  const token = options.token ?? "123:test";
  const requests: FakeTelegramRequest[] = [];
  const methodResults = new Map<string, unknown>();
  const methodErrors = new Map<string, { readonly error_code: number; readonly description: string }>();
  const files = new Map<string, { readonly content: Buffer; readonly contentType?: string }>();
  const updateQueue: Record<string, unknown>[] = [];
  const pendingGetUpdates: PendingGetUpdates[] = [];
  const waiters = new Map<string, Array<(request: FakeTelegramRequest) => void>>();

  const server = createServer(async (request, response) => {
    try {
      const parsedUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawBody = await readRawBody(request);
      const body = parseBody(rawBody, request.headers["content-type"]);
      const telegramMethod = methodFromPath(parsedUrl.pathname, token);
      const recorded: FakeTelegramRequest = {
        method: request.method ?? "GET",
        pathname: parsedUrl.pathname,
        telegramMethod,
        body,
        rawBody,
        query: parsedUrl.searchParams,
        headers: request.headers,
      };
      requests.push(recorded);
      notifyWaiters(waiters, recorded);

      if (request.method === "GET" && parsedUrl.pathname.startsWith(`/file/bot${token}/`)) {
        respondWithFile(response, files, decodeURIComponent(parsedUrl.pathname.slice(`/file/bot${token}/`.length)));
        return;
      }

      if (request.method !== "POST" || telegramMethod === undefined) {
        writeJson(response, 404, { ok: false, error_code: 404, description: "Not Found" });
        return;
      }

      const forcedError = methodErrors.get(telegramMethod);
      if (forcedError !== undefined) {
        writeJson(response, 200, { ok: false, ...forcedError });
        return;
      }

      if (telegramMethod === "getUpdates") {
        handleGetUpdates({ request: recorded, response, updateQueue, pendingGetUpdates });
        return;
      }

      writeJson(response, 200, { ok: true, result: resultForMethod(telegramMethod, body, methodResults) });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error_code: 500,
        description: error instanceof Error ? error.message : "Fake Telegram API error",
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    token,
    url,
    get requests() {
      return requests;
    },
    enqueueUpdate(update) {
      updateQueue.push(update);
      flushOnePendingGetUpdates(pendingGetUpdates, updateQueue);
    },
    setMethodError(method, error) {
      methodErrors.set(method, error);
    },
    setMethodResult(method, result) {
      methodResults.set(method, result);
    },
    setFile(path, content, init) {
      files.set(path, {
        content: typeof content === "string" ? Buffer.from(content) : Buffer.from(content),
        contentType: init?.contentType,
      });
    },
    waitForMethod(method, waitOptions = {}) {
      const afterIndex = waitOptions.afterIndex ?? -1;
      const existingIndex = requests.findIndex(
        (request, index) => index > afterIndex && request.telegramMethod === method,
      );
      if (existingIndex !== -1) {
        return Promise.resolve(requests[existingIndex]!);
      }

      return waitForFutureMethod({ method, waiters, timeoutMs: waitOptions.timeoutMs });
    },
    waitForNextMethod(method, waitOptions = {}) {
      return waitForFutureMethod({ method, waiters, timeoutMs: waitOptions.timeoutMs });
    },
    async close() {
      for (const pending of pendingGetUpdates.splice(0)) {
        writeJson(pending.response, 200, { ok: true, result: [] });
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

function notifyWaiters(
  waiters: Map<string, Array<(request: FakeTelegramRequest) => void>>,
  request: FakeTelegramRequest,
) {
  if (request.telegramMethod === undefined) return;
  const methodWaiters = waiters.get(request.telegramMethod) ?? [];
  waiters.delete(request.telegramMethod);
  for (const waiter of methodWaiters) {
    waiter(request);
  }
}

function waitForFutureMethod(args: {
  readonly method: string;
  readonly waiters: Map<string, Array<(request: FakeTelegramRequest) => void>>;
  readonly timeoutMs?: number;
}): Promise<FakeTelegramRequest> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const methodWaiters = args.waiters.get(args.method) ?? [];
      args.waiters.set(
        args.method,
        methodWaiters.filter((waiter) => waiter !== waiterWithTimeout),
      );
      reject(new Error(`Timed out waiting for Telegram method ${args.method}`));
    }, args.timeoutMs ?? 1_000);

    const waiterWithTimeout = (request: FakeTelegramRequest) => {
      clearTimeout(timeout);
      resolve(request);
    };
    args.waiters.set(args.method, [...(args.waiters.get(args.method) ?? []), waiterWithTimeout]);
  });
}

function methodFromPath(pathname: string, token: string): string | undefined {
  const prefix = `/bot${token}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined;
}

function resultForMethod(
  method: string,
  body: unknown,
  methodResults: ReadonlyMap<string, unknown>,
): unknown {
  if (methodResults.has(method)) {
    return methodResults.get(method);
  }

  if (method === "getMe") return fakeBotInfo();
  if (method === "sendMessage") {
    const request = bodyAsRecord(body);
    return telegramSentMessage({
      message_id: 100,
      chat: { id: request.chat_id ?? request.chatId ?? 12345, type: "private", first_name: "Alice" },
      text: request.text ?? "",
      entities: request.entities,
    });
  }
  if (method === "editMessageText") return true;
  if (method === "getFile") {
    const request = bodyAsRecord(body);
    return telegramFile({ file_id: request.file_id ?? request.fileId ?? "file-id" });
  }
  if (
    method === "sendChatAction" ||
    method === "setMyCommands" ||
    method === "answerCallbackQuery" ||
    method === "deleteMessage" ||
    method === "deleteWebhook"
  ) {
    return true;
  }

  return true;
}

function handleGetUpdates(args: {
  readonly request: FakeTelegramRequest;
  readonly response: ServerResponse;
  readonly updateQueue: Record<string, unknown>[];
  readonly pendingGetUpdates: PendingGetUpdates[];
}) {
  const requestBody = bodyAsRecord(args.request.body);
  const offset = typeof requestBody.offset === "number" ? requestBody.offset : undefined;
  const readyUpdates = offset === undefined
    ? args.updateQueue.splice(0)
    : removeUpdatesAtOrAfter(args.updateQueue, offset);

  if (readyUpdates.length > 0) {
    writeJson(args.response, 200, { ok: true, result: readyUpdates });
    return;
  }

  args.pendingGetUpdates.push({ request: args.request, response: args.response });
}

function flushOnePendingGetUpdates(
  pendingGetUpdates: PendingGetUpdates[],
  updateQueue: Record<string, unknown>[],
) {
  const pending = pendingGetUpdates.shift();
  if (pending === undefined) return;
  const body = bodyAsRecord(pending.request.body);
  const offset = typeof body.offset === "number" ? body.offset : undefined;
  const updates = offset === undefined ? updateQueue.splice(0) : removeUpdatesAtOrAfter(updateQueue, offset);
  writeJson(pending.response, 200, { ok: true, result: updates });
}

function removeUpdatesAtOrAfter(updates: Record<string, unknown>[], offset: number) {
  const selected: Record<string, unknown>[] = [];
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const updateId = updates[index]?.update_id;
    if (typeof updateId !== "number" || updateId >= offset) {
      selected.unshift(...updates.splice(index, 1));
    }
  }
  return selected;
}

function respondWithFile(
  response: ServerResponse,
  files: ReadonlyMap<string, { readonly content: Buffer; readonly contentType?: string }>,
  path: string,
) {
  const file = files.get(path);
  if (file === undefined) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not Found");
    return;
  }

  response.writeHead(200, {
    "content-type": file.contentType ?? "application/octet-stream",
    "content-length": String(file.content.byteLength),
  });
  response.end(file.content);
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  if (response.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(payload.byteLength),
  });
  response.end(payload);
}

function readRawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseBody(rawBody: Buffer, contentType: string | undefined): unknown {
  if (rawBody.byteLength === 0) return {};
  const bodyText = rawBody.toString("utf8");
  if (contentType?.includes("application/json") === true) {
    return JSON.parse(bodyText) as unknown;
  }
  if (contentType?.includes("application/x-www-form-urlencoded") === true) {
    return Object.fromEntries(new URLSearchParams(bodyText));
  }
  return bodyText;
}

function bodyAsRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}
