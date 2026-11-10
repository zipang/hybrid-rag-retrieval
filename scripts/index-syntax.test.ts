import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { datasetConfigurations } from "../src/config/datasets";
import {
	createIndexStateStore,
	DEFAULT_INDEX_STATE_PATH,
	type GenerationRecord,
	type IndexState,
	type IndexStateStore
} from "../src/lib/index-state";
import type { QdrantClient } from "../src/lib/qdrant";
import { buildSyntaxIndexConfiguration } from "../src/lib/syntax/config";
import type { EncodedVector } from "../src/lib/syntax/encoder";
import {
	EmptyInputError,
	type ParsedText,
	ParseValidationError,
	ParserUnavailableError
} from "../src/lib/syntax/parser";
import {
	CustomCollectionStateError,
	indexSyntax,
	InvalidBatchSizeError,
	resolveCliTarget,
	schemaForCollection,
	SyntaxConfigurationChangeError,
	SyntaxModeClashError
} from "./index-syntax";

/** A hand-built parse of one short French sentence. */
const PARSED: ParsedText = {
	sentences: [
		[
			["Le", "le", "DET", 2, "det", ""],
			["garçon", "garçon", "NOUN", 3, "nsubj", ""],
			["regarde", "regarder", "VERB", 0, "root", ""]
		]
	]
};

/** Build a parser fake that returns a fixed result per input text. */
const parserFake = (results: Record<string, ParsedText | Error>) => ({
	parse: async (text: string): Promise<ParsedText> => {
		const result = results[text];

		if (result === undefined) {
			throw new ParseValidationError(`no fake parse for "${text}"`);
		}

		if (result instanceof Error) {
			throw result;
		}

		return result;
	}
});

/** Build a payload map from records; a record without text exercises the missing field. */
const payloadsOf = (records: Array<{ id: number; slogan?: string }>) =>
	new Map<number | string, Record<string, unknown>>(
		records.map((record) => [
			record.id,
			record.slogan === undefined ? { id: record.id } : { ...record }
		])
	);

/** Options of the client fake. */
type FakeClientOptions = {
	/** Identifiers returned by `scrollIds`. */
	ids: Array<number | string>;
	/** Payloads returned by `fetchPayloads`. */
	payloads: Map<number | string, Record<string, unknown>>;
	/** Identifiers that already hold an ast vector. */
	astPresent?: Array<number | string>;
	/** Identifiers whose vector update fails. */
	failUpdates?: Array<number | string>;
	/** Identifiers whose vector clear fails. */
	failDeletes?: Array<number | string>;
};

/** Build a Qdrant client fake that records every call. */
const clientFake = (options: FakeClientOptions) => {
	const astPresent = new Set<number | string>(options.astPresent ?? []);
	const failUpdates = new Set<number | string>(options.failUpdates ?? []);
	const failDeletes = new Set<number | string>(options.failDeletes ?? []);
	const updates: Array<{ id: number | string; rows: number[][] }> = [];
	const deletes: Array<{ ids: Array<number | string>; vectors: string[] }> = [];
	let updateBatches = 0;
	let ensureCalls = 0;

	const client: Pick<
		QdrantClient,
		"ensureAstVector" | "scrollIds" | "fetchPayloads" | "updateAstVectors" | "deleteVectors"
	> = {
		ensureAstVector: async () => {
			ensureCalls += 1;

			return true;
		},
		scrollIds: async () => [...options.ids],
		fetchPayloads: async (ids) =>
			new Map(ids.map((id) => [id, options.payloads.get(id) ?? {}])),
		updateAstVectors: async (points) => {
			updateBatches += 1;

			for (const point of points) {
				if (failUpdates.has(point.id)) {
					throw new Error(`update failed for ${point.id}`);
				}
			}

			for (const point of points) {
				updates.push(point);
				astPresent.add(point.id);
			}
		},
		deleteVectors: async (ids, vectors) => {
			deletes.push({ ids, vectors });

			for (const id of ids) {
				if (failDeletes.has(id)) {
					throw new Error(`clear failed for ${id}`);
				}
			}

			for (const id of ids) {
				astPresent.delete(id);
			}
		}
	};

	return {
		client,
		updates,
		deletes,
		updateBatches: () => updateBatches,
		ensureCalls: () => ensureCalls,
		astPresent: () => [...astPresent]
	};
};

/** Build one ready generation record. */
const generationRecord = (overrides: Partial<GenerationRecord> = {}): GenerationRecord => ({
	generation: "gen-1",
	status: "ready",
	writer: "writer-1",
	startedAt: "2026-11-10T00:00:00.000Z",
	updatedAt: "2026-11-10T00:00:00.000Z",
	readyAt: "2026-11-10T00:00:00.000Z",
	...overrides
});

/** Build the real state store over an in-memory file, so coverage validation runs. */
const stateFake = (record: GenerationRecord) => {
	let file = `${JSON.stringify({ version: 1, current: record }, null, 2)}\n`;
	const store: IndexStateStore = createIndexStateStore("/memory/state.json", {
		readFile: async () => file,
		writeFile: async (_path, data) => {
			file = data;
		},
		mkdir: async () => {},
		randomToken: () => "token-2",
		now: () => "2026-11-10T00:00:00.000Z"
	});

	return { store, read: (): IndexState => JSON.parse(file) as IndexState };
};

/** Collect log lines from one run. */
const logger = () => {
	const messages: string[] = [];

	return { messages, log: (message: string) => messages.push(message) };
};

describe("indexSyntax", () => {
	test("indexes a happy path in one update batch and publishes the coverage", async () => {
		const client = clientFake({
			ids: [1, 2, 3],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." },
				{ id: 3, slogan: "Il vient ?" }
			])
		});
		const state = stateFake(generationRecord());
		const { messages, log } = logger();
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": PARSED,
			"Il vient ?": PARSED
		});

		const summary = await indexSyntax({
			client: client.client,
			state: state.store,
			parser,
			log
		});

		expect(summary.coverage).toEqual({ eligible: 3, indexed: 3, unsupported: 0, failed: 0 });
		expect(client.updates).toHaveLength(3);
		expect(client.updateBatches()).toBe(1);
		expect(client.deletes).toHaveLength(0);
		expect(summary.cleared).toBe(0);

		const persisted = state.read().current?.syntax;

		expect(persisted?.status).toBe("ready");
		expect(persisted?.coverage).toEqual(summary.coverage);
		expect(persisted?.configuration.configId).toBe(summary.configuration.configId);
		expect(persisted?.exclusions ?? []).toHaveLength(0);
		expect(messages.length).toBeGreaterThan(0);
	});

	test("records a parse failure as unsupported with the error message", async () => {
		const client = clientFake({
			ids: [1, 2],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "  " }
			])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"  ": new ParseValidationError("sentence 0 has no root")
		});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.coverage).toEqual({ eligible: 2, indexed: 1, unsupported: 1, failed: 0 });
		expect(state.read().current?.syntax?.exclusions).toEqual([
			{ id: 2, reason: "invalid parse: sentence 0 has no root" }
		]);
	});

	test("records a blank text as unsupported through EmptyInputError", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "" }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "": new EmptyInputError() });

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.coverage).toEqual({ eligible: 1, indexed: 0, unsupported: 1, failed: 0 });
		expect(state.read().current?.syntax?.exclusions).toEqual([
			{ id: 1, reason: "input text is blank" }
		]);
	});

	test("records an empty encoded structure as unsupported", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });
		const encode = (): EncodedVector[] => [];

		const summary = await indexSyntax({
			client: client.client,
			state: state.store,
			parser,
			encode
		});

		expect(summary.coverage).toEqual({ eligible: 1, indexed: 0, unsupported: 1, failed: 0 });
		expect(state.read().current?.syntax?.exclusions).toEqual([
			{ id: 1, reason: "empty structure" }
		]);
		expect(client.updates).toHaveLength(0);
	});

	test("records a zero vector as unsupported", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });
		const encode = (): EncodedVector[] => [
			{ version: "coarse-3", dimensions: 256, values: new Array<number>(256).fill(0) }
		];

		const summary = await indexSyntax({
			client: client.client,
			state: state.store,
			parser,
			encode
		});

		expect(summary.coverage.unsupported).toBe(1);
		expect(state.read().current?.syntax?.exclusions?.[0]?.reason).toBe("empty structure");
	});

	test("records an update failure as failed and keeps the run going", async () => {
		const client = clientFake({
			ids: [1, 2, 3],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." },
				{ id: 3, slogan: "Il vient ?" }
			]),
			failUpdates: [3]
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": PARSED,
			"Il vient ?": PARSED
		});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.coverage).toEqual({ eligible: 3, indexed: 2, unsupported: 0, failed: 1 });
		expect(client.updates.map((update) => update.id)).toEqual([1, 2]);
		expect(client.updateBatches()).toBeGreaterThan(1);
		expect(state.read().current?.syntax?.exclusions).toEqual([
			{ id: 3, reason: "update failed for 3" }
		]);
	});

	test("reports one exclusion per excluded record and accounts for every identifier", async () => {
		const client = clientFake({
			ids: [1, 2, 3, 4],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." },
				{ id: 3, slogan: "Il vient ?" },
				{ id: 4 }
			]),
			failUpdates: [3]
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": new ParseValidationError("sentence 0 has no root"),
			"Il vient ?": PARSED
		});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });
		const { eligible, indexed, unsupported, failed } = summary.coverage;
		const exclusions = state.read().current?.syntax?.exclusions ?? [];

		expect(indexed + unsupported + failed).toBe(eligible);
		expect(eligible).toBe(4);
		expect(exclusions).toHaveLength(unsupported + failed);
		expect(exclusions.map((entry) => entry.id).sort()).toEqual([2, 3, 4]);
		expect(exclusions.every((entry) => entry.reason.trim() !== "")).toBe(true);
	});

	test("aborts without publishing when the parser is unavailable", async () => {
		const client = clientFake({
			ids: [1, 2],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." }
			])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": new ParserUnavailableError("model file is missing")
		});

		await expect(
			indexSyntax({ client: client.client, state: state.store, parser })
		).rejects.toBeInstanceOf(ParserUnavailableError);

		expect(state.read().current?.syntax).toBeUndefined();
		expect(state.read().current?.status).toBe("ready");
	});

	test("refuses a generation that already holds the other mode", async () => {
		const detailed = await buildSyntaxIndexConfiguration("detailed");
		const record = generationRecord({
			syntax: {
				configuration: detailed,
				status: "ready",
				coverage: { eligible: 0, indexed: 0, unsupported: 0, failed: 0 },
				updatedAt: "2026-11-10T00:00:00.000Z"
			}
		});
		const client = clientFake({ ids: [1], payloads: payloadsOf([{ id: 1, slogan: "x" }]) });
		const state = stateFake(record);
		const parser = parserFake({ x: PARSED });

		await expect(
			indexSyntax({ client: client.client, state: state.store, parser }, { mode: "coarse" })
		).rejects.toBeInstanceOf(SyntaxModeClashError);

		expect(client.ensureCalls()).toBe(0);
		expect(state.read().current?.syntax?.configuration.mode).toBe("detailed");
	});

	test("clears the ast vector of every excluded record in one batch", async () => {
		const client = clientFake({
			ids: [1, 2, 3],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." },
				{ id: 3 }
			]),
			astPresent: [2, 3]
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": new ParseValidationError("sentence 0 has no root")
		});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.cleared).toBe(2);
		expect(client.deletes).toEqual([{ ids: [2, 3], vectors: ["ast"] }]);
		expect(client.astPresent()).toEqual([1]);
	});

	test("sends no clear request when there is no excluded record", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(client.deletes).toHaveLength(0);
		expect(summary.cleared).toBe(0);
	});

	test("splits the clear into identifier batches", async () => {
		const client = clientFake({
			ids: [1, 2, 3],
			payloads: payloadsOf([{ id: 1 }, { id: 2 }, { id: 3 }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({});

		const summary = await indexSyntax(
			{ client: client.client, state: state.store, parser },
			{ batchSize: 2 }
		);

		expect(client.deletes.map((call) => call.ids)).toEqual([[1, 2], [3]]);
		expect(summary.cleared).toBe(3);
	});

	test("marks a record failed when its clear fails, and keeps the rest", async () => {
		const client = clientFake({
			ids: [1, 2],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }, { id: 2 }]),
			failDeletes: [2]
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });
		const { messages, log } = logger();

		const summary = await indexSyntax({
			client: client.client,
			state: state.store,
			parser,
			log
		});

		expect(summary.coverage).toEqual({ eligible: 2, indexed: 1, unsupported: 0, failed: 1 });
		expect(state.read().current?.syntax?.exclusions).toEqual([
			{ id: 2, reason: "clear failed: clear failed for 2" }
		]);
		expect(messages.some((message) => message.includes("clear"))).toBe(true);
	});

	test("publishes a fixed updatedAt from the injected clock", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });

		await indexSyntax({
			client: client.client,
			state: state.store,
			parser,
			now: () => "2026-01-02T03:04:05.000Z"
		});

		expect(state.read().current?.syntax?.updatedAt).toBe("2026-01-02T03:04:05.000Z");
	});

	test("rejects a non-positive batch size with a typed error", async () => {
		const client = clientFake({ ids: [], payloads: new Map() });
		const state = stateFake(generationRecord());
		const parser = parserFake({});

		await expect(
			indexSyntax({ client: client.client, state: state.store, parser }, { batchSize: 0 })
		).rejects.toBeInstanceOf(InvalidBatchSizeError);
	});

	test("publishes pending, not ready, when the limit truncates the collection", async () => {
		const client = clientFake({
			ids: [1, 2, 3],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." },
				{ id: 3, slogan: "Il vient ?" }
			])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": PARSED,
			"Il vient ?": PARSED
		});
		const { messages, log } = logger();

		const summary = await indexSyntax(
			{ client: client.client, state: state.store, parser, log },
			{ limit: 2 }
		);

		expect(summary.coverage).toEqual({ eligible: 2, indexed: 2, unsupported: 0, failed: 0 });
		expect(state.read().current?.syntax?.status).toBe("pending");
		expect(messages.some((message) => message.includes("2 of 3"))).toBe(true);
	});

	test("publishes ready when the limit covers the whole collection", async () => {
		const client = clientFake({
			ids: [1, 2],
			payloads: payloadsOf([
				{ id: 1, slogan: "Le garçon regarde le soleil." },
				{ id: 2, slogan: "Un chat mange une souris." }
			])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": PARSED,
			"Un chat mange une souris.": PARSED
		});

		await indexSyntax({ client: client.client, state: state.store, parser }, { limit: 2 });

		expect(state.read().current?.syntax?.status).toBe("ready");
	});

	test("records a structurally broken abstraction as unsupported", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({
			"Le garçon regarde le soleil.": {
				sentences: [
					[
						["Le", "le", "DET", 2, "det", ""],
						["garçon", "garçon", "NOUN", 1, "nsubj", ""]
					]
				]
			}
		});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.coverage).toEqual({ eligible: 1, indexed: 0, unsupported: 1, failed: 0 });
		expect(state.read().current?.syntax?.exclusions?.[0]?.reason).toBe(
			"abstraction failed: sentence has no root"
		);
	});

	test("refuses a configuration change on the same generation", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");
		const record = generationRecord({
			syntax: {
				configuration: { ...configuration, configId: "0000000000000000" },
				status: "ready",
				coverage: { eligible: 0, indexed: 0, unsupported: 0, failed: 0 },
				updatedAt: "2026-11-10T00:00:00.000Z"
			}
		});
		const client = clientFake({ ids: [1], payloads: payloadsOf([{ id: 1, slogan: "x" }]) });
		const state = stateFake(record);
		const parser = parserFake({ x: PARSED });

		await expect(
			indexSyntax({ client: client.client, state: state.store, parser })
		).rejects.toBeInstanceOf(SyntaxConfigurationChangeError);

		expect(client.ensureCalls()).toBe(0);
		expect(state.read().current?.syntax?.configuration.configId).toBe("0000000000000000");
	});

	test("accepts a re-run with the same configuration", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");
		const record = generationRecord({
			syntax: {
				configuration,
				status: "pending",
				coverage: { eligible: 0, indexed: 0, unsupported: 0, failed: 0 },
				updatedAt: "2026-11-10T00:00:00.000Z"
			}
		});
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(record);
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });

		expect(summary.coverage).toEqual({ eligible: 1, indexed: 1, unsupported: 0, failed: 0 });
		expect(state.read().current?.syntax?.status).toBe("ready");
	});

	test("publishes a ready empty coverage for an empty collection", async () => {
		const client = clientFake({ ids: [], payloads: new Map() });
		const state = stateFake(generationRecord());
		const parser = parserFake({});

		const summary = await indexSyntax({ client: client.client, state: state.store, parser });
		const persisted = state.read().current?.syntax;

		expect(summary.coverage).toEqual({ eligible: 0, indexed: 0, unsupported: 0, failed: 0 });
		expect(persisted?.status).toBe("ready");
		expect(persisted?.exclusions ?? []).toHaveLength(0);
	});

	test("refuses a generation that is not ready", async () => {
		const client = clientFake({ ids: [1], payloads: payloadsOf([{ id: 1, slogan: "x" }]) });
		const state = stateFake(generationRecord({ status: "rebuilding" }));
		const parser = parserFake({ x: PARSED });

		await expect(
			indexSyntax({ client: client.client, state: state.store, parser })
		).rejects.toThrow(/owned by writer/);

		expect(state.read().current?.syntax).toBeUndefined();
	});

	test("never sends a point upsert or a collection deletion", async () => {
		const client = clientFake({
			ids: [1],
			payloads: payloadsOf([{ id: 1, slogan: "Le garçon regarde le soleil." }])
		});
		const state = stateFake(generationRecord());
		const parser = parserFake({ "Le garçon regarde le soleil.": PARSED });

		await indexSyntax({ client: client.client, state: state.store, parser });

		expect(Object.keys(client.client).sort()).toEqual([
			"deleteVectors",
			"ensureAstVector",
			"fetchPayloads",
			"scrollIds",
			"updateAstVectors"
		]);
		expect("upsert" in client.client).toBe(false);
		expect("deleteCollection" in client.client).toBe(false);
	});
});

describe("schemaForCollection", () => {
	test("overrides only the collection name of the slogan schema", () => {
		const schema = schemaForCollection("t0004-task13-probe");

		expect(schema.collection).toBe("t0004-task13-probe");
		expect(schema.dense).toEqual(datasetConfigurations.slogans.collectionSchema.dense);
		expect(schema.sparse).toEqual(datasetConfigurations.slogans.collectionSchema.sparse);
		expect(schema.ast).toEqual(datasetConfigurations.slogans.collectionSchema.ast);
		expect(schema.payloadIndexes).toEqual(
			datasetConfigurations.slogans.collectionSchema.payloadIndexes
		);
	});
});

describe("resolveCliTarget", () => {
	test("keeps the dataset collection and the default state path without flags", () => {
		const target = resolveCliTarget({});

		expect(target.schema.collection).toBe("slogans");
		expect(target.statePath).toBe(DEFAULT_INDEX_STATE_PATH);
	});

	test("accepts a default-collection run with an explicit state path", () => {
		const target = resolveCliTarget({
			collection: "slogans",
			statePath: ".tmp/probe-state.json"
		});

		expect(target.schema.collection).toBe("slogans");
		expect(target.statePath).toBe(".tmp/probe-state.json");
	});

	test("accepts an isolated collection with an explicit state path", () => {
		const target = resolveCliTarget({
			collection: "t0004-task13-probe",
			statePath: ".tmp/probe-state.json"
		});

		expect(target.schema.collection).toBe("t0004-task13-probe");
		expect(target.statePath).toBe(".tmp/probe-state.json");
	});

	test("refuses an isolated collection that would publish into the real state file", () => {
		const run = () => resolveCliTarget({ collection: "t0004-task13-probe" });

		expect(run).toThrow(CustomCollectionStateError);
		expect(run).toThrow(/INDEX_STATE_PATH/);
	});

	test("refuses an isolated collection with a blank state path", () => {
		expect(() =>
			resolveCliTarget({ collection: "t0004-task13-probe", statePath: "   " })
		).toThrow(CustomCollectionStateError);
	});

	test("refuses the default state file however the path is written", () => {
		for (const statePath of [
			DEFAULT_INDEX_STATE_PATH,
			`./${DEFAULT_INDEX_STATE_PATH}`,
			`${dirname(DEFAULT_INDEX_STATE_PATH)}/../${DEFAULT_INDEX_STATE_PATH}`
		]) {
			expect(() => resolveCliTarget({ collection: "t0004-task13-probe", statePath })).toThrow(
				CustomCollectionStateError
			);
		}
	});

	test("refuses an absolute path that resolves to the default state file", () => {
		expect(() =>
			resolveCliTarget({
				collection: "t0004-task13-probe",
				statePath: resolve(DEFAULT_INDEX_STATE_PATH)
			})
		).toThrow(CustomCollectionStateError);
	});
});
