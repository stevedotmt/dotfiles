/**
 * Auto-session-name
 *
 * After the first agent run of an unnamed session, asks a cheap model
 * for a short title and sets it via pi.setSessionName(). Pi shows the
 * session name in the footer natively.
 *
 * Disable by removing this file from ~/.pi/agent/extensions/.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";

// Cheap models, in preference order; the first with configured auth is used.
const CANDIDATES: Array<[provider: string, id: string]> = [
	["fireworks", "accounts/fireworks/models/glm-5p3-flash"],
	["anthropic", "claude-haiku-4-5"],
];

const MAX_NAME_LENGTH = 60;

function messageText(message: unknown): string {
	const m = message as { role?: string; content?: unknown };
	if (m?.role !== "user") return "";
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		return m.content
			.filter((c): c is { type: "text"; text: string } => c?.type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	return "";
}

function sanitizeName(raw: string): string {
	return raw
		.split("\n")[0]
		.replace(/^["'`#*\s]+|["'`#*\s.]+$/g, "")
		.slice(0, MAX_NAME_LENGTH)
		.trim();
}

async function generateName(
	ctx: ExtensionContext,
	userText: string,
): Promise<string | undefined> {
	for (const [provider, id] of CANDIDATES) {
		const model = ctx.modelRegistry.find(provider, id);
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) continue;

		const response = await ctx.modelRegistry.complete(
			model,
			{
				messages: [
					{
						role: "user" as const,
						content: [
							{
								type: "text" as const,
								text:
									"Write a very short title (3-7 words, no quotes, no punctuation at the end) " +
									"for a coding session that starts with this request. Reply with the title only.\n\n" +
									userText.slice(0, 2000),
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{ reasoningEffort: "low", cacheRetention: "none", sessionId: uuidv7() },
		);

		const name = sanitizeName(
			response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join(" "),
		);
		if (name) return name;
	}
	return undefined;
}

export default function(pi: ExtensionAPI) {
	let naming = false;

	pi.on("agent_end", async (event, ctx) => {
		// Only name once, only unnamed sessions, only persisted sessions.
		if (naming || pi.getSessionName()) return;
		if (!ctx.sessionManager.getSessionFile()) return;

		const userText = event.messages.map(messageText).find((t) => t.trim());
		if (!userText) return;

		naming = true;
		try {
			const name = await generateName(ctx, userText);
			if (name && !pi.getSessionName()) {
				pi.setSessionName(name);
			}
		} catch {
			// Cheap-model naming is best-effort; never break the session over it.
		} finally {
			naming = false;
		}
	});
}
