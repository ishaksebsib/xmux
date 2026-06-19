import { Buffer } from "node:buffer";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

export interface UnixSocketFetchOptions {
  readonly socketPath: string;
  /** Synthetic origin used to construct Request objects for local Unix-socket calls. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const defaultBaseUrl = "http://xmux.local";

const hasRequestBody = (method: string): boolean => method !== "GET" && method !== "HEAD";

const readBody = async (request: Request): Promise<Buffer | undefined> => {
  if (!hasRequestBody(request.method)) return undefined;
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return undefined;
  return Buffer.from(body);
};

const requestHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const responseHeaders = (headers: IncomingHttpHeaders): Headers => {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
      continue;
    }
    result.set(key, value);
  }
  return result;
};

/**
 * Fetch-compatible transport for generated clients that talk to the local
 * server over a Unix domain socket instead of TCP.
 */
export const unixSocketFetch = (options: UnixSocketFetchOptions): typeof fetch => {
  const baseUrl = options.baseUrl ?? defaultBaseUrl;
  const timeoutMs = options.timeoutMs;

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url, baseUrl);
    const body = await readBody(request);

    return await new Promise<Response>((resolve, reject) => {
      const nodeRequest = httpRequest(
        {
          socketPath: options.socketPath,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: requestHeaders(request.headers),
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          });
          response.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 0,
                statusText: response.statusMessage,
                headers: responseHeaders(response.headers),
              }),
            );
          });
        },
      );

      nodeRequest.once("error", reject);
      nodeRequest.once("timeout", () => {
        nodeRequest.destroy();
        reject(new Error(`Timed out reaching xmux server socket: ${options.socketPath}`));
      });

      if (body !== undefined) {
        nodeRequest.write(body);
      }
      nodeRequest.end();
    });
  };
};
