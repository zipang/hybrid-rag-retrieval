import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import type { WeightedHit } from "../../lib/retrieval-contract";
import type { SloganFields } from "../api";
import { type AgentSource, collectTurnActivity, toAgentSource } from "./sources";

/** Payload field names used by the mapping under test. */
const FIELDS: SloganFields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

/** One agent source with the given identity and score. */
const source = (id: number | string, score: number): AgentSource => ({
	id,
	annee: 2000,
	marque: `Brand-${String(id)}`,
	campagne: "",
	slogan: `Slogan ${String(id)}`,
	score
});

/**
 * Build a UI message with the given role from parts.
 *
 * The cast injects the exact part shapes that the runtime produces; the test asserts the pure
 * collector, not the SDK types.
 */
const message = (role: "user" | "assistant", parts: unknown[]): UIMessage =>
	({ id: `${role}-1`, role, parts }) as unknown as UIMessage;

/** Build one `output-available` tool part. */
const outputPart = (tool: string, output: unknown, input: unknown = {}) => ({
	type: `tool-${tool}`,
	state: "output-available",
	toolCallId: "call-1",
	input,
	output
});

describe("toAgentSource", () => {
	test("maps one weighted hit through the slogan field names", () => {
		const hit: WeightedHit = {
			id: 7,
			score: 0.75,
			scores: { semantic: 0.75 },
			payload: { annee: 1991, marque: "Danone", campagne: "C1", slogan: "Un peu de sucre" }
		};

		expect(toAgentSource(hit, FIELDS)).toEqual({
			id: 7,
			annee: 1991,
			marque: "Danone",
			campagne: "C1",
			slogan: "Un peu de sucre",
			score: 0.75
		});
	});

	test("defaults a missing payload value instead of throwing", () => {
		const hit: WeightedHit = { id: 7, score: 0.5, scores: {}, payload: {} };

		expect(toAgentSource(hit, FIELDS)).toEqual({
			id: 7,
			annee: 0,
			marque: "",
			campagne: "",
			slogan: "",
			score: 0.5
		});
	});

	test("defaults a non-numeric year to zero", () => {
		const hit: WeightedHit = {
			id: 7,
			score: 0.5,
			scores: {},
			payload: { annee: "not-a-year", marque: "Danone", slogan: "Texte" }
		};

		expect(toAgentSource(hit, FIELDS).annee).toBe(0);
	});
});

describe("collectTurnActivity", () => {
	test("reads only the parts after the last user message", () => {
		const messages = [
			message("assistant", [
				outputPart("searchRecords", { results: [source(1, 0.9)] }, { query: "ancien" })
			]),
			message("user", [{ type: "text", text: "sucre" }]),
			message("assistant", [
				outputPart("searchRecords", { results: [source(2, 0.5)] }, { query: "sucre" })
			])
		];

		expect(collectTurnActivity(messages)).toEqual([
			{ tool: "searchRecords", query: "sucre", sources: [source(2, 0.5)] }
		]);
	});

	test("returns one entry per tool call in message order", () => {
		const messages = [
			message("user", [{ type: "text", text: "sucre" }]),
			message("assistant", [
				outputPart("searchRecords", { results: [source(1, 0.9)] }, { query: "sucre" }),
				outputPart("fetchNextPage", { results: [source(2, 0.4)] }, { cursor: "c" })
			])
		];

		expect(collectTurnActivity(messages)).toEqual([
			{ tool: "searchRecords", query: "sucre", sources: [source(1, 0.9)] },
			{ tool: "fetchNextPage", query: "", sources: [source(2, 0.4)] }
		]);
	});

	test("trims the searchRecords query and defaults a missing input to empty", () => {
		const messages = [
			message("user", [{ type: "text", text: "q" }]),
			message("assistant", [
				outputPart("searchRecords", { results: [source(1, 0.9)] }, { query: "  sucre  " }),
				outputPart("searchRecords", { results: [source(2, 0.5)] }, { query: 42 })
			])
		];

		expect(collectTurnActivity(messages).map((entry) => entry.query)).toEqual(["sucre", ""]);
	});

	test("labels a fetchNextPage call with an empty query", () => {
		const messages = [
			message("user", [{ type: "text", text: "q" }]),
			message("assistant", [
				outputPart("fetchNextPage", { results: [source(1, 0.9)] }, { cursor: "c" })
			])
		];

		expect(collectTurnActivity(messages)[0]?.query).toBe("");
	});

	test("keeps the per-call source order without deduplicating", () => {
		const messages = [
			message("user", [{ type: "text", text: "q" }]),
			message("assistant", [
				outputPart("searchRecords", { results: [source(1, 0.9)] }, { query: "a" }),
				outputPart("fetchNextPage", { results: [source(1, 0.2)] }, { cursor: "c" })
			])
		];

		expect(collectTurnActivity(messages)).toEqual([
			{ tool: "searchRecords", query: "a", sources: [source(1, 0.9)] },
			{ tool: "fetchNextPage", query: "", sources: [source(1, 0.2)] }
		]);
	});

	test("skips an error output", () => {
		const messages = [
			message("user", [{ type: "text", text: "q" }]),
			message("assistant", [
				outputPart("searchRecords", { error: "index unavailable" }, { query: "sucre" })
			])
		];

		expect(collectTurnActivity(messages)).toEqual([]);
	});

	test("returns an empty list without a user message", () => {
		const messages = [
			message("assistant", [
				outputPart("searchRecords", { results: [source(1, 0.9)] }, { query: "sucre" })
			])
		];

		expect(collectTurnActivity(messages)).toEqual([]);
	});

	test("returns an empty list when no tool part follows the user message", () => {
		const messages = [
			message("user", [{ type: "text", text: "q" }]),
			message("assistant", [{ type: "text", text: "answer" }])
		];

		expect(collectTurnActivity(messages)).toEqual([]);
	});

	test("returns an empty list for no messages", () => {
		expect(collectTurnActivity([])).toEqual([]);
	});
});
