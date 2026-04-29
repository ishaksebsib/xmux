import { randomUUID } from "node:crypto";

import "dotenv/config";

import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import {
	AuthStorage,
	createAgentSession,
	type AgentSession,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { createOpencode } from "@opencode-ai/sdk";
import { Chat } from "chat";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const allowedUserIds = new Set(
	(process.env.XMUX_ALLOWED_TELEGRAM_USER_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean),
);
const workdir = process.env.XMUX_WORKDIR?.trim() || process.cwd();

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (allowedUserIds.size === 0) throw new Error("XMUX_ALLOWED_TELEGRAM_USER_IDS is required");

let opencode: Awaited<ReturnType<typeof createOpencode>> | undefined;
const activeSessions = new Map<string, "opencode" | "pi">();
const opencodeSessions = new Map<string, string>();
const piSessions = new Map<string, AgentSession>();

const telegram = createTelegramAdapter({
	botToken: token,
	longPolling: { allowedUpdates: ["message"] },
	mode: "polling",
});

const bot = new Chat({
	adapters: { telegram },
	concurrency: "queue",
	logger: "info",
	state: createMemoryState(),
	userName: "xmux",
});

bot.onDirectMessage(async (thread, message) => {
	if (message.author.isBot === true || message.author.isMe) return;

	if (!allowedUserIds.has(message.author.userId)) {
		console.log(`User ${message.author.userId} is not allowed to control this xmux instance`);
		await thread.post("You are not allowed to control this xmux instance.");
		return;
	}

	const text = message.text.trim().replace(/\s+/g, " ").toLowerCase();
	if (
		text !== "create session opencode" &&
		text !== "/create_session opencode" &&
		text !== "create session pi" &&
		text !== "/create_session pi"
	) {
		const activeSession = activeSessions.get(message.author.userId);
		if (!activeSession) {
			await thread.post("Unknown command. Try: create session opencode or create session pi");
			return;
		}

		if (activeSession === "pi") {
			const session = piSessions.get(message.author.userId);
			if (!session) {
				await thread.post("No PI session found. Try: create session pi");
				return;
			}

			const sent = await thread.post("PI is thinking...");
			let reply = "";
			let lastEdit = 0;
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					reply += event.assistantMessageEvent.delta;
					const now = Date.now();
					if (now - lastEdit > 750) {
						lastEdit = now;
						void sent.edit(reply.slice(-3800));
					}
				}
			});

			try {
				await session.prompt(message.text);
				await sent.edit(reply.slice(-3800) || "PI finished with no text response.");
			} catch (error) {
				await sent.edit(`PI prompt failed.\n${error instanceof Error ? error.message : String(error)}`);
			} finally {
				unsubscribe();
			}
			return;
		}

		const sessionId = opencodeSessions.get(message.author.userId);
		if (!sessionId) {
			await thread.post("No OpenCode session found. Try: create session opencode");
			return;
		}

		await thread.post(
			(async function* () {
				try {
					opencode ??= await createOpencode({ port: 0, timeout: 15_000 });
					const result = await opencode.client.session.prompt({
						body: { parts: [{ type: "text", text: message.text }] },
						path: { id: sessionId },
						query: { directory: workdir },
					});

					if (result.error || !result.data) {
						throw new Error(result.error ? JSON.stringify(result.error) : "OpenCode did not return a response");
					}

					const reply = result.data.parts
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n")
						.trim();

					for (const chunk of (reply || "OpenCode finished with no text response.").match(/[\s\S]{1,600}/g) ?? []) {
						yield chunk;
						await new Promise((resolve) => setTimeout(resolve, 25));
					}
				} catch (error) {
					yield `OpenCode prompt failed.\n${error instanceof Error ? error.message : String(error)}`;
				}
			})(),
		);
		return;
	}

	if (text === "create session pi" || text === "/create_session pi") {
		await thread.post("Creating PI session...");

		try {
			const authStorage = AuthStorage.create();
			const modelRegistry = ModelRegistry.create(authStorage);
			const { session } = await createAgentSession({
				authStorage,
				cwd: workdir,
				modelRegistry,
				sessionManager: SessionManager.create(workdir),
			});

			piSessions.get(message.author.userId)?.dispose();
			piSessions.set(message.author.userId, session);
			activeSessions.set(message.author.userId, "pi");

			await thread.post(`Created PI session ${session.sessionId}.\nDirectory: ${workdir}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await thread.post(`Could not create PI session.\n${message}`);
		}
		return;
	}

	await thread.post("Creating OpenCode session...");

	try {
		opencode ??= await createOpencode({ port: 0, timeout: 15_000 });
		const result = await opencode.client.session.create({
			body: { title: `xmux Telegram session ${new Date().toISOString()}` },
			query: { directory: workdir },
		});

		if (result.error || !result.data) {
			throw new Error(result.error ? JSON.stringify(result.error) : "OpenCode did not return a session");
		}

		opencodeSessions.set(message.author.userId, result.data.id);
		activeSessions.set(message.author.userId, "opencode");

		await thread.post(
			`Created OpenCode session xmux_${randomUUID().slice(0, 8)}.\nOpenCode session: ${result.data.id}\nDirectory: ${workdir}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await thread.post(`Could not start OpenCode. Is \`opencode\` installed and available on PATH?\n${message}`);
	}
});

await bot.initialize();

console.log(`xmux Telegram MVP is running. Workdir: ${workdir}`);

process.once("SIGINT", () => {
	opencode?.server.close();
	for (const session of piSessions.values()) session.dispose();
	process.exit(0);
});

process.once("SIGTERM", () => {
	opencode?.server.close();
	for (const session of piSessions.values()) session.dispose();
	process.exit(0);
});
