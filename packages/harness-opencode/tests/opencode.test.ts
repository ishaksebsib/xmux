import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { HarnessAdapterCreateSessionError, createHarness } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../src";

function hasOpenCodeBinary(): boolean {
  const command = process.platform === "win32" ? "where opencode" : "command -v opencode";
  return (
    spawnSync(
      process.platform === "win32" ? "cmd" : "sh",
      [process.platform === "win32" ? "/c" : "-lc", command],
      {
        stdio: "ignore",
      },
    ).status === 0
  );
}

const opencodeBinaryTest = hasOpenCodeBinary() ? test : test.skip;

function createNativeSession(args: { readonly directory: string; readonly title: string }) {
  return {
    id: "session-1",
    slug: "session-1-slug",
    projectID: "project-1",
    directory: args.directory,
    title: args.title,
    version: "1.0.0",
    time: { created: 1, updated: 1 },
  };
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body.length > 0 ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function startSessionServer() {
  const requests: {
    readonly method?: string;
    readonly pathname: string;
    readonly body: unknown;
  }[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readRequestJson(request);
    requests.push({ method: request.method, pathname: url.pathname, body });

    if (request.method === "POST" && url.pathname === "/session") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          createNativeSession({
            directory: url.searchParams.get("directory") ?? process.cwd(),
            title: typeof body.title === "string" ? body.title : "xmux session",
          }),
        ),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(`http://127.0.0.1:${address.port}`);
        return;
      }
      reject(new Error("Failed to start test OpenCode server"));
    });
  });

  return {
    requests,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("createOpenCodeAdapter", () => {
  opencodeBinaryTest("creates a session against an embedded OpenCode runtime", async () => {
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter(),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "xmux embedded session",
      });

      expect(created.isOk()).toBe(true);

      const session = created.unwrap("expected embedded OpenCode session to be created");
      expect(session.ref.harnessId).toBe("opencode");
      expect(session.title).toBe("xmux embedded session");
      expect(session.adapterData.directory).toBe(process.cwd());
      expect(session.adapterData.projectId.length).toBeGreaterThan(0);
      expect(session.adapterData.slug.length).toBeGreaterThan(0);
      expect(session.adapterData.version.length).toBeGreaterThan(0);
    } finally {
      //TODO: delete the sessions after the test
      await harness.close();
    }
  });

  test("creates a session against an external OpenCode runtime", async () => {
    const server = await startSessionServer();
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter({
          mode: "external",
          baseUrl: server.url,
        }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "xmux external session",
      });

      expect(created.isOk()).toBe(true);

      const session = created.unwrap("expected external OpenCode session to be created");
      expect(session.ref.harnessId).toBe("opencode");
      expect(session.title).toBe("xmux external session");
      expect(session.adapterData.directory).toBe(process.cwd());
      expect(session.adapterData.projectId.length).toBeGreaterThan(0);
      expect(session.adapterData.slug.length).toBeGreaterThan(0);
      expect(server.requests).toEqual([
        expect.objectContaining({
          method: "POST",
          pathname: "/session",
          body: expect.objectContaining({ title: "xmux external session" }),
        }),
      ]);
    } finally {
      await harness.close();
      await server.close();
    }
  });

  test("surfaces external runtime session creation failures", async () => {
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter({
          mode: "external",
          baseUrl: "http://127.0.0.1:1",
        }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
      });

      expect(created.isErr()).toBe(true);
      if (created.isErr()) {
        expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
      }
    } finally {
      await harness.close();
    }
  });
});
