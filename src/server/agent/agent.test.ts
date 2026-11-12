import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { SloganFields } from "../api";
import { DEFAULT_MAX_STEPS, createRetrievalAgent } from "./agent";
import { createSearchSessionStore } from "./session-store";
import { createFetchNextPageTool, createSearchRecordsTool } from "./tools";

/** Payload field names used by the tool set. */
const FIELDS: SloganFields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

/** Usage that the mock model reports for one step. */
const USAGE = {
	inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 5, text: 5, reasoning: undefined }
};

/** Build the retrieval tool set over a retriever that returns an empty page. */
const buildTools = () => {
	const dependencies = {
		retriever: {
			retrieveWeighted: async () => ({
				results: [],
				metadata: {
					weights: { syntax: 0.5, semantic: 0.3, keyword: 0.2 },
					minScore: 0.5,
					normalizationVersion: "1",
					generation: "gen-1"
				}
			})
		},
		sessions: createSearchSessionStore(),
		fields: FIELDS,
		weights: { syntax: 0.5, semantic: 0.3, keyword: 0.2 },
		minScore: 0.5,
		sessionId: "s1"
	};

	return {
		searchRecords: createSearchRecordsTool(dependencies),
		fetchNextPage: createFetchNextPageTool(dependencies)
	};
};

/** A mock model that requests the same tool call on every step. */
const alwaysCallsTool = () =>
	new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "searchRecords",
					input: '{"query":"sucre"}'
				}
			],
			finishReason: { unified: "tool-calls", raw: undefined },
			usage: USAGE,
			warnings: []
		})
	});

describe("createRetrievalAgent", () => {
	test("defaults the step budget to six", () => {
		expect(DEFAULT_MAX_STEPS).toBe(6);
	});

	test("exposes the tool set it was given", () => {
		const agent = createRetrievalAgent({ model: alwaysCallsTool(), tools: buildTools() });

		expect(Object.keys(agent.tools).sort()).toEqual(["fetchNextPage", "searchRecords"]);
	});

	test("stops after the default step budget", async () => {
		const model = alwaysCallsTool();
		const agent = createRetrievalAgent({ model, tools: buildTools() });

		await agent.generate({ prompt: "Slogans sur le sucre." });

		expect(model.doGenerateCalls).toHaveLength(DEFAULT_MAX_STEPS);
	});

	test("stops after the chosen step budget", async () => {
		const model = alwaysCallsTool();
		const agent = createRetrievalAgent({ model, tools: buildTools(), maxSteps: 2 });

		await agent.generate({ prompt: "Slogans sur le sucre." });

		expect(model.doGenerateCalls).toHaveLength(2);
	});
});
