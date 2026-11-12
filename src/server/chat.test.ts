import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { WeightedHit, WeightedQuery, WeightedResultPage } from "../lib/retrieval-contract";
import { createAgentSessionCache, type AgentResource } from "./agent/resource";
import { createSearchSessionStore } from "./agent/session-store";
import { createChatHandler, DEFAULT_MIN_SCORE, DEFAULT_WEIGHTS } from "./chat";
import type { SloganFields } from "./api";

/** Payload field names used by the handler under test. */
const FIELDS: SloganFields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

/** One weighted hit with the slogan payload. */
const HIT: WeightedHit = {
	id: 2,
	score: 0.5,
	scores: { semantic: 0.5 },
	payload: { annee: 2004, marque: "Danone", campagne: "C1", slogan: "Un peu de sucre" }
};

/** One weighted result page with a continuation cursor. */
const PAGE: WeightedResultPage = {
	results: [HIT],
	nextCursor: "retrieval-next",
	metadata: {
		weights: { syntax: 0.5, semantic: 0.3, keyword: 0.2 },
		minScore: 0.5,
		normalizationVersion: "1",
		generation: "gen-1"
	}
};

/** Usage reported by the mock model. */
const USAGE = {
	inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 5, text: 5, reasoning: undefined }
};

/** A model that streams a short text answer. */
const textModel = () =>
	new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: "text-start", id: "t1" },
					{ type: "text-delta", id: "t1", delta: "Bonjour" },
					{ type: "text-end", id: "t1" },
					{
						type: "finish",
						finishReason: { unified: "stop", raw: undefined },
						logprobs: undefined,
						usage: USAGE
					}
				]
			})
		})
	});

/** A model that first calls `searchRecords`, then streams an answer. */
const toolThenTextModel = () =>
	new MockLanguageModelV4({
		doStream: [
			{
				stream: simulateReadableStream({
					chunks: [
						{
							type: "tool-call",
							toolCallId: "call-1",
							toolName: "searchRecords",
							input: '{"query":"sucre"}'
						},
						{
							type: "finish",
							finishReason: { unified: "tool-calls", raw: undefined },
							logprobs: undefined,
							usage: USAGE
						}
					]
				})
			},
			{
				stream: simulateReadableStream({
					chunks: [
						{ type: "text-start", id: "t1" },
						{ type: "text-delta", id: "t1", delta: "Danone (2004)" },
						{ type: "text-end", id: "t1" },
						{
							type: "finish",
							finishReason: { unified: "stop", raw: undefined },
							logprobs: undefined,
							usage: USAGE
						}
					]
				})
			}
		]
	});

/** Build the request body for one question. */
const body = (id?: string, agentId?: string) =>
	JSON.stringify({
		...(id === undefined ? {} : { id }),
		...(agentId === undefined ? {} : { agentId }),
		messages: [
			{ id: "m1", role: "user", parts: [{ type: "text", text: "Slogans sur le sucre" }] }
		]
	});

/** Create a handler with a fake retriever, a fake model, and a real store. */
const createTestHandler = (
	model: MockLanguageModelV4,
	env: Record<string, string | undefined> = { AI_API_KEY: "test" },
	options: { maxSteps?: number; defaultAgentId?: string } = {}
) => {
	const queries: WeightedQuery[] = [];
	const saved: Array<{ sessionId: string; search: unknown }> = [];
	const loaded: string[] = [];
	const sessions = createSearchSessionStore();
	const loadAgent = (id: string): AgentResource => {
		loaded.push(id);

		return { id, description: `d-${id}`, language: "fr", instructions: `instructions-${id}` };
	};
	const agents = createAgentSessionCache(loadAgent);
	let created = 0;

	const handler = createChatHandler({
		retriever: {
			retrieveWeighted: async (query) => {
				queries.push(query);

				return PAGE;
			}
		},
		sessions: {
			save: (sessionId, search) => {
				saved.push({ sessionId, search });

				return sessions.save(sessionId, search);
			},
			read: sessions.read,
			update: sessions.update
		},
		agents,
		defaultAgentId: "default",
		fields: FIELDS,
		weights: DEFAULT_WEIGHTS,
		minScore: DEFAULT_MIN_SCORE,
		env,
		identity: { userAgent: "test/1.0", sessionId: "test-session" },
		createModel: () => {
			created += 1;

			return model;
		},
		...options
	});

	return { handler, queries, saved, loaded, getCreated: () => created };
};

/** Send one POST request to the handler. */
const post = (handler: (request: Request) => Promise<Response>, id?: string, agentId?: string) =>
	handler(
		new Request("http://localhost/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: body(id, agentId)
		})
	);

describe("createChatHandler", () => {
	test("answers a preflight request with 204 and CORS headers", async () => {
		const { handler } = createTestHandler(textModel());
		const response = await handler(
			new Request("http://localhost/api/chat", { method: "OPTIONS" })
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
	});

	test("rejects a non-POST method with 405", async () => {
		const { handler } = createTestHandler(textModel());
		const response = await handler(new Request("http://localhost/api/chat"));

		expect(response.status).toBe(405);
	});

	test("returns 500 before any model call when the API key is missing", async () => {
		const { handler, getCreated, queries } = createTestHandler(textModel(), {});

		const response = await post(handler);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "AI_API_KEY is not set; the chat endpoint needs an LLM provider."
		});
		expect(getCreated()).toBe(0);
		expect(queries).toEqual([]);
	});

	test("rejects an empty message list with 400", async () => {
		const { handler } = createTestHandler(textModel());
		const response = await handler(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({})
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Body must contain a non-empty "messages" array.'
		});
	});

	test("returns a UI message stream with the answer text", async () => {
		const { handler } = createTestHandler(textModel());

		const response = await post(handler);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const stream = await response.text();

		expect(stream).toContain("Bonjour");
	});

	test("wires the searchRecords tool into the agent", async () => {
		const { handler, queries } = createTestHandler(toolThenTextModel());

		const response = await post(handler, "conv-1");
		const stream = await response.text();

		expect(stream).toContain("searchRecords");
		expect(queries).toHaveLength(1);
		expect(queries[0]).toEqual({
			text: "sucre",
			weights: DEFAULT_WEIGHTS,
			minScore: DEFAULT_MIN_SCORE,
			pageSize: 5,
			limit: 50
		});
	});

	test("uses the anonymous session when the body has no id", async () => {
		const { handler, saved } = createTestHandler(toolThenTextModel());

		await (await post(handler)).text();

		expect(saved[0]?.sessionId).toBe("anonymous");
	});

	test("uses the conversation id as the session when the body has one", async () => {
		const { handler, saved } = createTestHandler(toolThenTextModel());

		await (await post(handler, "conv-42")).text();

		expect(saved[0]?.sessionId).toBe("conv-42");
	});

	test("loads the default agent when the body names none", async () => {
		const { handler, loaded } = createTestHandler(textModel());

		await (await post(handler, "conv-1")).text();

		expect(loaded).toEqual(["default"]);
	});

	test("loads the agent named by the body", async () => {
		const { handler, loaded } = createTestHandler(textModel());

		await (await post(handler, "conv-1", "citations")).text();

		expect(loaded).toEqual(["citations"]);
	});

	test("trims the agent id from the body", async () => {
		const { handler, loaded } = createTestHandler(textModel());

		await (await post(handler, "conv-1", "  citations  ")).text();

		expect(loaded).toEqual(["citations"]);
	});

	test("uses the default agent id from the dependencies", async () => {
		const { handler, loaded } = createTestHandler(
			textModel(),
			{ AI_API_KEY: "test" },
			{
				defaultAgentId: "citations"
			}
		);

		await (await post(handler, "conv-1")).text();

		expect(loaded).toEqual(["citations"]);
	});

	test("loads the agent once per session", async () => {
		const { handler, loaded } = createTestHandler(textModel());

		await (await post(handler, "conv-1")).text();
		await (await post(handler, "conv-1")).text();

		expect(loaded).toEqual(["default"]);
	});

	test("uses the resolved resource instructions as the system prompt", async () => {
		const model = textModel();
		const { handler } = createTestHandler(model);

		await (await post(handler, "conv-1", "citations")).text();

		expect(JSON.stringify(model.doStreamCalls)).toContain("instructions-citations");
	});
});
