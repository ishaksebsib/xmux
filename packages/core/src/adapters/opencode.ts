import { createOpencode } from "@opencode-ai/sdk";

type OpenCodeRuntime = Awaited<ReturnType<typeof createOpencode>>;

export class OpenCodeHarnessAdapter {
  readonly id = "opencode";
  readonly type = "harness" as const;
  private runtime?: OpenCodeRuntime;

  constructor(private readonly options: { cwd?: string } = {}) {}

  async start() {
    this.runtime ??= await createOpencode({ port: 0 });
  }

  async createSession(input: { name?: string; cwd?: string } = {}) {
    await this.start();

    const result = await this.runtime!.client.session.create({
      body: { title: input.name ?? "xmux opencode" },
      // TODO: make this dynamic later
      query: {
        directory:
          input.cwd ?? this.options.cwd ?? "/home/pro/Development/Projects/OpenSource/xmux/",
      },
    });

    if (result.error || !result.data) {
      throw new Error(`OpenCode session create failed: ${JSON.stringify(result.error)}`);
    }

    return result.data.id;
  }

  async stop() {
    this.runtime?.server.close();
    this.runtime = undefined;
  }
}
