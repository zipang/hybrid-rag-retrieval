import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import type { WeightedHit } from "../../lib/retrieval-contract";
import type { SloganFields } from "../api";
import { type AgentSource, collectSources, toAgentSource } from "./sources";

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
 * Build an assistant UI message from parts.
 *
 * The cast injects the exact part shapes that the runtime produces; the test asserts the pure
 * collector, not the SDK types.
 */
const message = (parts: unknown[]): UIMessage =>
	({ id: "m1", role: "assistant", parts }) as unknown as UIMessage;

/** Build one `output-available` tool part. */
const outputPart = (tool: string, output: unknown) => ({
	type: `tool-${tool}`,
	state: "output-available",
	toolCallId: "call-1",
	input: {},
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

describe("collectSources", () => {
	test("collects the results of both tools", () => {
		const messages = [
			message([
				outputPart("searchRecords", { results: [source(1, 0.9)], hasMore: true }),
				outputPart("fetchNextPage", { results: [source(2, 0.4)], hasMore: false })
			])
		];

		expect(collectSources(messages).map((entry) => entry.id)).toEqual([1, 2]);
	});

	test("deduplicates by id and keeps the highest score", () => {
		const messages = [
			message([
				outputPart("searchRecords", { results: [source(1, 0.3)], hasMore: false }),
				outputPart("fetchNextPage", { results: [source(1, 0.8)], hasMore: false })
			])
		];

		expect(collectSources(messages)).toEqual([{ ...source(1, 0.8) }]);
	});

	test("orders by descending score then ascending id", () => {
		const messages = [
			message([
				outputPart("searchRecords", {
					results: [source(3, 0.5), source(1, 0.9), source(2, 0.5), source(10, 0.5)],
					hasMore: false
				})
			])
		];

		expect(collectSources(messages).map((entry) => entry.id)).toEqual([1, 2, 3, 10]);
	});

	test("ignores text parts and unknown part types", () => {
		const messages = [
			message([
				{ type: "text", text: "Bonjour" },
				{ type: "step-start" },
				{
					type: "tool-other",
					state: "output-available",
					output: { results: [source(9, 1)] }
				}
			])
		];

		expect(collectSources(messages)).toEqual([]);
	});

	test("ignores a tool part that has not produced an output", () => {
		const messages = [
			message([
				{ type: "tool-searchRecords", state: "input-available", input: { query: "sucre" } },
				{ type: "tool-fetchNextPage", state: "output-error", errorText: "boom" }
			])
		];

		expect(collectSources(messages)).toEqual([]);
	});

	test("ignores an error output", () => {
		const messages = [message([outputPart("searchRecords", { error: "index unavailable" })])];

		expect(collectSources(messages)).toEqual([]);
	});

	test("returns an empty list for no messages", () => {
		expect(collectSources([])).toEqual([]);
	});
});
