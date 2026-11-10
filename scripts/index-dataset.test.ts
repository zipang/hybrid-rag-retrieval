import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	createCitationSession,
	createSloganSession,
	datasetRunners,
	DenseDimensionMismatchError,
	ForeignStatePathError,
	IncompleteEmbeddingError,
	IndexConfigurationMismatchError,
	indexDataset,
	parseCliOptions,
	resolveDatasetName,
	UnknownDatasetError
} from "./index-dataset";
import type { Embedder } from "../src/lib/embedder";
import { createIndexStateStore } from "../src/lib/index-state";
import type { createQdrantClient, Point, QdrantClient } from "../src/lib/qdrant";

/** Dense dimensions of both configured datasets. */
const DIMENSIONS = 1024;

/** Client operations that the indexer depends on. */
type FakeClientSurface = Pick<
	QdrantClient,
	"deleteCollection" | "ensureCollection" | "scrollIds" | "upsert"
>;

/** Recorded calls of the fake client. */
type FakeClient = {
	client: FakeClientSurface;
	calls: string[];
	upserts: Point[][];
};

/** Fake embedder and the text batches that it received. */
type FakeEmbedder = {
	embedder: Pick<Embedder, "embedDenseDocuments" | "dims">;
	texts: string[][];
};

/** Build a fake client that records its calls and the points it receives. */
const createFakeClient = (existing: Array<number | string> = []): FakeClient => {
	const calls: string[] = [];
	const upserts: Point[][] = [];

	return {
		calls,
		upserts,
		client: {
			deleteCollection: async () => {
				calls.push("deleteCollection");
			},
			ensureCollection: async () => {
				calls.push("ensureCollection");

				return true;
			},
			scrollIds: async () => {
				calls.push("scrollIds");

				return [...existing];
			},
			upsert: async (points) => {
				calls.push("upsert");
				upserts.push(points);
			}
		}
	};
};

/** Build a fake embedder that records the texts and returns zero vectors. */
const createFakeEmbedder = (dims: number = DIMENSIONS): FakeEmbedder => {
	const texts: string[][] = [];

	return {
		texts,
		embedder: {
			dims,
			embedDenseDocuments: async (input) => {
				texts.push(input);

				return input.map(() => Array.from({ length: dims }, () => 0));
			}
		}
	};
};

/** One slogan corpus block with a valid record. */
const sloganBlock = (id: number): string =>
	[`Id: ${id}`, "Année: 2000", "Marque: Brand", `Slogan: Slogan ${id}`, "---"].join("\n");

/** One citation corpus block with a valid record. */
const citationBlock = (id: number): string =>
	[
		`id: ${id}`,
		"author: Author",
		"work: Work",
		"year: 1600",
		"lang: fr",
		"trad:",
		`quote: Citation ${id}`,
		"---"
	].join("\n");

/** Build a slogan corpus of `count` records. */
const sloganCorpus = (count: number, firstId: number = 1): string =>
	Array.from({ length: count }, (_, index) => sloganBlock(firstId + index)).join("\n");

/** A block that the citation validator rejects, because it lacks required fields. */
const REJECTED_BLOCK = ["id: 99", "quote: Missing author, work, and language", "---"].join("\n");

/** Run one test against a temporary corpus file and its directory. */
const withTemporaryCorpus = async (
	text: string,
	run: (filePath: string, directory: string) => Promise<void>
): Promise<void> => {
	const root = join(import.meta.dir, "../.tmp");
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "index-dataset-"));
	const filePath = join(directory, "corpus.txt");
	await Bun.write(filePath, text);

	try {
		await run(filePath, directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

describe("resolveDatasetName", () => {
	test("defaults to the slogan dataset", () => {
		expect(resolveDatasetName(undefined)).toBe("slogans");
	});

	test("refuses an unknown dataset and lists the valid names", () => {
		expect(() => resolveDatasetName("unknown")).toThrow(UnknownDatasetError);
		expect(() => resolveDatasetName("unknown")).toThrow(/slogans, citations/);
	});
});

describe("parseCliOptions", () => {
	test("defaults to the slogan dataset and its legacy state file", () => {
		expect(parseCliOptions([])).toEqual({
			dataset: "slogans",
			drop: false,
			limit: undefined,
			batchSize: undefined,
			statePath: "data/index-state.json"
		});
	});

	test("reads the dataset, the flags, and the per-dataset state file", () => {
		expect(
			parseCliOptions([
				"--dataset",
				"citations",
				"--drop",
				"--limit",
				"10",
				"--batch-size",
				"4"
			])
		).toEqual({
			dataset: "citations",
			drop: true,
			limit: 10,
			batchSize: 4,
			statePath: "data/index-state.citations.json"
		});
	});

	test("refuses a state path that belongs to another dataset", () => {
		expect(() =>
			parseCliOptions(["--dataset", "citations"], {
				INDEX_STATE_PATH: "data/index-state.json"
			})
		).toThrow(ForeignStatePathError);
		expect(() =>
			parseCliOptions(["--dataset", "slogans"], {
				INDEX_STATE_PATH: "./data/index-state.citations.json"
			})
		).toThrow(/the citations dataset/);
	});

	test("refuses a state path that reaches another dataset file through ..", () => {
		expect(() =>
			parseCliOptions(["--dataset", "slogans"], {
				INDEX_STATE_PATH: "data/../data/index-state.citations.json"
			})
		).toThrow(ForeignStatePathError);
	});

	test("accepts a probe state path outside the dataset defaults", () => {
		expect(
			parseCliOptions(["--dataset", "citations"], {
				INDEX_STATE_PATH: ".tmp/probe-state.json"
			})
		).toMatchObject({ statePath: ".tmp/probe-state.json" });
	});

	test("lets INDEX_STATE_PATH override the state file of every dataset", () => {
		expect(
			parseCliOptions(["--dataset", "citations"], { INDEX_STATE_PATH: ".tmp/probe.json" })
		).toMatchObject({ statePath: ".tmp/probe.json" });
	});

	test("returns null for --help", () => {
		expect(parseCliOptions(["--help"])).toBeNull();
	});

	test("refuses an unknown flag", () => {
		expect(() => parseCliOptions(["--unknown"])).toThrow(/Unknown argument "--unknown"/);
	});

	test("refuses a bad value", () => {
		expect(() => parseCliOptions(["--limit", "0"])).toThrow(/Invalid --limit value "0"/);
		expect(() => parseCliOptions(["--dataset", "unknown"])).toThrow(UnknownDatasetError);
	});
});

describe("datasetRunners", () => {
	/** Sentinel error that stops a runner before it loads a real model. */
	class StopBeforeEmbedder extends Error {
		constructor() {
			super("stop before the embedder loads");
		}
	}

	test("builds its client from the selected dataset schema", async () => {
		const seen: string[] = [];
		const createClient: typeof createQdrantClient = (schema) => {
			seen.push(schema.collection);

			throw new StopBeforeEmbedder();
		};
		const context = { env: {}, statePath: ".tmp/state.json", options: {}, createClient };

		await expect(datasetRunners.citations(context)).rejects.toBeInstanceOf(StopBeforeEmbedder);
		await expect(datasetRunners.slogans(context)).rejects.toBeInstanceOf(StopBeforeEmbedder);

		expect(seen).toEqual(["citations", "slogans"]);
	});
});

describe("indexDataset", () => {
	test("imports the citation dataset with quote as content and id as identifier", async () => {
		const session = createCitationSession();

		expect(session.configuration.filePath).toBe("datasets/citations.txt");
		expect(session.configuration.collectionSchema.collection).toBe("citations");

		await withTemporaryCorpus(
			`${citationBlock(1)}\n${citationBlock(2)}`,
			async (filePath, directory) => {
				const fake = createFakeClient();
				const embedder = createFakeEmbedder();
				const state = createIndexStateStore(join(directory, "state.json"));

				const summary = await indexDataset(
					session,
					{
						client: fake.client,
						embedder: embedder.embedder,
						bm25: { language: "french" },
						state,
						configId: "cfg-test"
					},
					{ filePath }
				);

				expect(summary.dataset).toBe("citations");
				expect(summary.accepted).toBe(2);
				expect(summary.indexed).toBe(2);
				expect(embedder.texts).toEqual([["Citation 1", "Citation 2"]]);
				expect(fake.upserts[0]?.map((point) => point.id)).toEqual([1, 2]);
				expect(fake.upserts[0]?.map((point) => point.payload.quote)).toEqual([
					"Citation 1",
					"Citation 2"
				]);
			}
		);
	});

	test("calls ensureCollection and never deleteCollection by default", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			);

			expect(fake.calls).toContain("ensureCollection");
			expect(fake.calls).not.toContain("deleteCollection");
			expect(fake.calls).toContain("scrollIds");
			expect(fake.calls.indexOf("ensureCollection")).toBeLessThan(
				fake.calls.indexOf("upsert")
			);
		});
	});

	test("drops the collection first and skips the identifier scroll when drop is set", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient([1]);
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath, drop: true }
			);

			expect(fake.calls.slice(0, 2)).toEqual(["deleteCollection", "ensureCollection"]);
			expect(fake.calls).not.toContain("scrollIds");
			expect(summary.skipped).toBe(0);
			expect(summary.indexed).toBe(2);
		});
	});

	test("skips the records that the collection already holds", async () => {
		await withTemporaryCorpus(sloganCorpus(3), async (filePath, directory) => {
			const fake = createFakeClient([1, 2]);
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			);

			expect(summary.accepted).toBe(3);
			expect(summary.skipped).toBe(2);
			expect(summary.indexed).toBe(1);
			expect(summary.total).toBe(3);
			expect(embedder.texts).toEqual([["Slogan 3"]]);
			expect(fake.upserts.flat().map((point) => point.id)).toEqual([3]);
		});
	});

	test("publishes once with the total count when the stream ends by itself", async () => {
		await withTemporaryCorpus(sloganCorpus(3), async (filePath, directory) => {
			const fake = createFakeClient([7]);
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-a"
				},
				{ filePath }
			);

			const persisted = await createIndexStateStore(storePath).read();

			expect(summary.published).toBe(true);
			expect(summary.total).toBe(4);
			expect(persisted.current?.status).toBe("ready");
			expect(persisted.current?.recordCount).toBe(4);
			expect(persisted.current?.configId).toBe("cfg-a");
		});
	});

	test("publishes when --limit equals the number of new records", async () => {
		await withTemporaryCorpus(sloganCorpus(3), async (filePath, directory) => {
			const fake = createFakeClient([7]);
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath, limit: 3 }
			);

			const persisted = await createIndexStateStore(storePath).read();

			expect(summary.published).toBe(true);
			expect(summary.indexed).toBe(3);
			expect(summary.total).toBe(4);
			expect(persisted.current?.status).toBe("ready");
			expect(persisted.current?.recordCount).toBe(4);
		});
	});

	test("proves the truncation with one record and never writes it", async () => {
		await withTemporaryCorpus(sloganCorpus(5), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath, limit: 2 }
			);

			const persisted = await createIndexStateStore(storePath).read();

			expect(summary.published).toBe(false);
			expect(summary.indexed).toBe(2);
			expect(persisted.current?.status).toBe("rebuilding");
			expect(embedder.texts).toEqual([["Slogan 1", "Slogan 2"]]);
			expect(fake.upserts.flat().map((point) => point.id)).toEqual([1, 2]);
		});
	});

	test("normalizes a string identifier from scrollIds before the skip lookup", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient(["1"]);
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			);

			expect(summary.skipped).toBe(1);
			expect(summary.indexed).toBe(1);
			expect(embedder.texts).toEqual([["Slogan 2"]]);
			expect(fake.upserts.flat().map((point) => point.id)).toEqual([2]);
		});
	});

	test("refuses a fingerprint difference before any write", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			await state.beginRebuild({ configId: "old" });

			await expect(
				indexDataset(
					createSloganSession(),
					{
						client: fake.client,
						embedder: embedder.embedder,
						bm25: {},
						state,
						configId: "new"
					},
					{ filePath }
				)
			).rejects.toBeInstanceOf(IndexConfigurationMismatchError);

			const persisted = await state.read();

			expect(fake.calls).toEqual([]);
			expect(persisted.current?.configId).toBe("old");
			expect(persisted.current?.status).toBe("rebuilding");
		});
	});

	test("skips the fingerprint comparison when drop is set", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			await state.beginRebuild({ configId: "old" });

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "new"
				},
				{ filePath, drop: true }
			);

			expect(summary.published).toBe(true);
			expect((await state.read()).current?.configId).toBe("new");
		});
	});

	test("refuses a dense dimension mismatch before ensureCollection", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder(384);
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			await expect(
				indexDataset(
					createSloganSession(),
					{
						client: fake.client,
						embedder: embedder.embedder,
						bm25: {},
						state,
						configId: "cfg-test"
					},
					{ filePath }
				)
			).rejects.toBeInstanceOf(DenseDimensionMismatchError);

			expect(fake.calls).toEqual([]);
			expect(await Bun.file(storePath).exists()).toBe(false);
		});
	});

	test("splits the corpus into several upsert calls", async () => {
		await withTemporaryCorpus(sloganCorpus(5), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath, batchSize: 2 }
			);

			expect(summary.indexed).toBe(5);
			expect(fake.upserts.map((points) => points.length)).toEqual([2, 2, 1]);
		});
	});

	test("counts a rejected block and keeps indexing", async () => {
		await withTemporaryCorpus(
			`${citationBlock(1)}\n${REJECTED_BLOCK}\n${citationBlock(2)}`,
			async (filePath, directory) => {
				const fake = createFakeClient();
				const embedder = createFakeEmbedder();
				const state = createIndexStateStore(join(directory, "state.json"));

				const summary = await indexDataset(
					createCitationSession(),
					{
						client: fake.client,
						embedder: embedder.embedder,
						bm25: {},
						state,
						configId: "cfg-test"
					},
					{ filePath }
				);

				expect(summary.rejected).toBe(1);
				expect(summary.accepted).toBe(2);
				expect(summary.indexed).toBe(2);
				expect(embedder.texts).toEqual([["Citation 1", "Citation 2"]]);
			}
		);
	});

	test("treats an empty collection as a first run", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient([]);
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			);

			expect(summary.skipped).toBe(0);
			expect(summary.total).toBe(summary.indexed);
			expect(summary.published).toBe(true);
		});
	});

	test("resumes a truncated chunk with a second run over the same state and collection", async () => {
		await withTemporaryCorpus(sloganCorpus(5), async (filePath, directory) => {
			const storePath = join(directory, "state.json");
			const run1 = createFakeClient();
			const run1Embedder = createFakeEmbedder();

			const first = await indexDataset(
				createSloganSession(),
				{
					client: run1.client,
					embedder: run1Embedder.embedder,
					bm25: {},
					state: createIndexStateStore(storePath),
					configId: "cfg-test"
				},
				{ filePath, limit: 2 }
			);

			expect(first.published).toBe(false);
			expect(first.indexed).toBe(2);
			expect((await createIndexStateStore(storePath).read()).current?.status).toBe(
				"rebuilding"
			);

			const writtenIds = run1.upserts.flat().map((point) => point.id);

			expect(writtenIds).toEqual([1, 2]);

			const run2 = createFakeClient(writtenIds);
			const run2Embedder = createFakeEmbedder();

			const second = await indexDataset(
				createSloganSession(),
				{
					client: run2.client,
					embedder: run2Embedder.embedder,
					bm25: {},
					state: createIndexStateStore(storePath),
					configId: "cfg-test"
				},
				{ filePath }
			);

			const persisted = await createIndexStateStore(storePath).read();

			expect(second.published).toBe(true);
			expect(second.skipped).toBe(first.indexed);
			expect(second.indexed).toBe(3);
			expect(second.total).toBe(5);
			expect(persisted.current?.status).toBe("ready");
			expect(persisted.current?.recordCount).toBe(5);
			expect(run2Embedder.texts).toEqual([["Slogan 3", "Slogan 4", "Slogan 5"]]);
			expect(run2.upserts.flat().map((point) => point.id)).toEqual([3, 4, 5]);
		});
	});

	test("counts a repeated identifier once and publishes the point count", async () => {
		const duplicated = [sloganBlock(1), sloganBlock(2), sloganBlock(2)].join("\n");

		await withTemporaryCorpus(duplicated, async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			);

			const persisted = await createIndexStateStore(storePath).read();

			expect(summary.indexed).toBe(2);
			expect(summary.skipped).toBe(1);
			expect(summary.total).toBe(2);
			expect(summary.published).toBe(true);
			expect(persisted.current?.recordCount).toBe(2);
			expect(fake.upserts.flat().map((point) => point.id)).toEqual([1, 2]);
		});
	});

	test("publishes a corpus of 1,2,2 with a limit of 2", async () => {
		const duplicated = [sloganBlock(1), sloganBlock(2), sloganBlock(2)].join("\n");

		await withTemporaryCorpus(duplicated, async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const storePath = join(directory, "state.json");
			const state = createIndexStateStore(storePath);

			const summary = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath, limit: 2 }
			);

			expect(summary.published).toBe(true);
			expect(summary.indexed).toBe(2);
			expect(summary.total).toBe(2);
		});
	});

	test("refuses an embedder that returns fewer vectors than the batch", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const state = createIndexStateStore(join(directory, "state.json"));
			const short = {
				dims: DIMENSIONS,
				embedDenseDocuments: async (input: string[]) =>
					input.slice(0, 1).map(() => Array.from({ length: DIMENSIONS }, () => 0))
			};

			const error = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: short,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			).catch((thrown: unknown) => thrown);

			expect(error).toBeInstanceOf(IncompleteEmbeddingError);
			expect(error).toMatchObject({ received: 1, expected: 2 });
			expect((error as IncompleteEmbeddingError).message).toBe(
				"the dense embedder returned 1 vector(s) for 2 record(s); refusing to write a " +
					"point with an empty dense vector"
			);
			expect(fake.upserts).toEqual([]);
		});
	});

	test("refuses an embedder that returns more vectors than the batch", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const state = createIndexStateStore(join(directory, "state.json"));
			const long = {
				dims: DIMENSIONS,
				embedDenseDocuments: async (input: string[]) =>
					[...input, ...input].map(() => Array.from({ length: DIMENSIONS }, () => 0))
			};

			const error = await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: long,
					bm25: {},
					state,
					configId: "cfg-test"
				},
				{ filePath }
			).catch((thrown: unknown) => thrown);

			expect(error).toBeInstanceOf(IncompleteEmbeddingError);
			expect(error).toMatchObject({ received: 4, expected: 2 });
			expect(fake.upserts).toEqual([]);
		});
	});

	test("logs one progress line per flush", async () => {
		await withTemporaryCorpus(sloganCorpus(2), async (filePath, directory) => {
			const fake = createFakeClient();
			const embedder = createFakeEmbedder();
			const state = createIndexStateStore(join(directory, "state.json"));
			const lines: string[] = [];

			await indexDataset(
				createSloganSession(),
				{
					client: fake.client,
					embedder: embedder.embedder,
					bm25: {},
					state,
					log: (message) => lines.push(message),
					configId: "cfg-test"
				},
				{ filePath }
			);

			expect(lines).toContainEqual(
				expect.stringMatching(/^Indexed 2 \(skipped 0, rejected 0\) in \d+s/)
			);
		});
	});
});
