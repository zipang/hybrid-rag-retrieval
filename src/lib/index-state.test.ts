import { describe, expect, test } from "bun:test";
import {
	ConcurrentWriteError,
	createIndexStateStore,
	type IndexStateDependencies,
	InvalidSyntaxCoverageError,
	StaleGenerationError,
	type SyntaxIndexConfiguration,
	type SyntaxIndexState,
	SyntaxNotReadyError
} from "./index-state";

/** Build in-memory dependencies with a deterministic clock and token source. */
const createMemoryDependencies = () => {
	const files = new Map<string, string>();
	let clock = 0;
	let token = 0;

	const dependencies: IndexStateDependencies = {
		readFile: async (path) => {
			const content = files.get(path);

			if (content === undefined) {
				const error = new Error("missing") as Error & { code: string };
				error.code = "ENOENT";

				throw error;
			}

			return content;
		},
		writeFile: async (path, data) => {
			files.set(path, data);
		},
		mkdir: async () => {},
		randomToken: () => {
			token += 1;

			return `token-${token}`;
		},
		now: () => {
			clock += 1;

			return `2026-01-01T00:00:${String(clock).padStart(2, "0")}.000Z`;
		}
	};

	return { dependencies, files };
};

describe("createIndexStateStore", () => {
	test("returns an empty state when the file is absent", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);

		expect(await store.read()).toEqual({ version: 1 });
	});

	test("begins a rebuild in the rebuilding state", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const record = await store.beginRebuild();

		expect(record.status).toBe("rebuilding");
		expect(record.generation).toBe("token-1");
		expect(record.writer).toBe("token-2");
	});

	test("publishes a ready generation with the record count", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild();
		const ready = await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 42,
			configId: "cfg-1"
		});

		expect(ready.status).toBe("ready");
		expect(ready.recordCount).toBe(42);
		expect(ready.configId).toBe("cfg-1");
		expect(ready.readyAt).toBeDefined();
	});

	test("persists the state across store instances", async () => {
		const { dependencies } = createMemoryDependencies();
		const first = createIndexStateStore("state.json", dependencies);
		const begun = await first.beginRebuild();

		await first.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 7
		});

		const second = createIndexStateStore("state.json", dependencies);
		const state = await second.read();

		expect(state.current?.generation).toBe(begun.generation);
		expect(state.current?.status).toBe("ready");
	});

	test("detects a concurrent writer that presents a different token", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild();

		await expect(
			store.publish({
				writer: "other-writer",
				expectedGeneration: begun.generation,
				recordCount: 1
			})
		).rejects.toBeInstanceOf(ConcurrentWriteError);
	});

	test("rejects a rebuild that presents a different live writer token", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(store.beginRebuild({ writer: "writer-b" })).rejects.toBeInstanceOf(
			ConcurrentWriteError
		);
		await expect(store.beginRebuild({ writer: "writer-a" })).rejects.toBeInstanceOf(
			ConcurrentWriteError
		);
		expect(begun.writer).toBe("writer-a");
	});

	test("detects a generation change before publication", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild();

		await expect(
			store.publish({
				writer: begun.writer,
				expectedGeneration: "different-generation",
				recordCount: 1
			})
		).rejects.toBeInstanceOf(StaleGenerationError);
	});

	test("recovers an interrupted writer on the next rebuild", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const abandoned = await store.beginRebuild();

		expect(abandoned.status).toBe("rebuilding");
		expect(await store.read()).toMatchObject({
			current: { status: "rebuilding" }
		});

		const recovered = await store.beginRebuild();

		expect(recovered.generation).not.toBe(abandoned.generation);
		expect(recovered.status).toBe("rebuilding");
	});

	test("assertReady returns the record for the current ready generation", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild();

		await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 3
		});

		const record = await store.assertReady(begun.generation);

		expect(record.generation).toBe(begun.generation);
		expect(record.status).toBe("ready");
	});

	test("assertReady rejects a changed generation", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);

		await store.beginRebuild();

		await expect(store.assertReady("gone")).rejects.toBeInstanceOf(StaleGenerationError);
	});

	test("assertReady rejects a rebuild in progress", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild();

		await expect(store.assertReady(begun.generation)).rejects.toBeInstanceOf(
			ConcurrentWriteError
		);
	});

	test("recovers from a corrupt state file", async () => {
		const { dependencies, files } = createMemoryDependencies();

		files.set("state.json", "not json");

		const store = createIndexStateStore("state.json", dependencies);

		await expect(store.read()).rejects.toThrow();
	});
});

/** Frozen configuration of the coarse syntax index used by the tests. */
const SYNTAX_CONFIGURATION: SyntaxIndexConfiguration = {
	mode: "coarse",
	language: "fr",
	parserVersion: "udpipe-wasm-0.1.0",
	modelRevision: "french-gsd-2.17",
	abstractionVersion: "abstract-1",
	encoderVersion: "coarse-3",
	dimensions: 256,
	configId: "syntax-cfg-coarse-3"
};

/** Build a ready syntax state with complete coverage and one exclusion per excluded record. */
const syntaxState = (overrides: Partial<SyntaxIndexState> = {}): SyntaxIndexState => ({
	configuration: SYNTAX_CONFIGURATION,
	status: "ready",
	coverage: { eligible: 10, indexed: 8, unsupported: 1, failed: 1 },
	updatedAt: "2026-01-01T00:00:00.000Z",
	exclusions: [
		{ id: 100, reason: "parser returned no sentence" },
		{ id: 101, reason: "parser timed out" }
	],
	...overrides
});

describe("publishSyntax", () => {
	test("persists the syntax state on the generation record and round-trips it", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });
		const syntax = syntaxState();

		const record = await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax
		});

		expect(record.generation).toBe(begun.generation);
		// Publishing the syntax state does not publish the generation itself.
		expect(record.status).toBe("rebuilding");
		expect(record.syntax).toEqual(syntax);

		const reloaded = await createIndexStateStore("state.json", dependencies).read();

		expect(reloaded.current?.syntax).toEqual(syntax);
	});

	test("keeps the syntax state when the generation is later published ready", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax: syntaxState({ status: "pending" })
		});
		const ready = await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 10
		});

		expect(ready.syntax?.configuration.configId).toBe(SYNTAX_CONFIGURATION.configId);
	});

	test("refuses a different writer token", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: "writer-b",
				expectedGeneration: begun.generation,
				syntax: syntaxState()
			})
		).rejects.toBeInstanceOf(ConcurrentWriteError);
	});

	test("refuses a changed generation", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: "other-generation",
				syntax: syntaxState()
			})
		).rejects.toBeInstanceOf(StaleGenerationError);
	});

	test("refuses a ready state whose coverage does not add up", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 8, unsupported: 1, failed: 0 }
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("accepts a pending state with an open coverage count", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		const record = await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax: syntaxState({
				status: "pending",
				coverage: { eligible: 10, indexed: 0, unsupported: 0, failed: 0 }
			})
		});

		expect(record.syntax?.status).toBe("pending");
	});

	test("refuses an exclusion without a reason", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 10, unsupported: 0, failed: 0 },
					exclusions: [{ id: 3, reason: " " }]
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("refuses an exclusion without an identifier", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 10, unsupported: 0, failed: 0 },
					exclusions: [{ id: "", reason: "parser returned no sentence" }]
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("accepts exclusions that carry an identifier and a reason", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });
		const syntax = syntaxState({
			coverage: { eligible: 2, indexed: 1, unsupported: 1, failed: 0 },
			exclusions: [{ id: 3, reason: "parser returned no sentence" }]
		});

		const record = await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax
		});

		expect(record.syntax?.exclusions).toEqual(syntax.exclusions);
	});

	test("refuses a ready state that excludes records without listing them", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 5, unsupported: 5, failed: 0 },
					exclusions: undefined
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("refuses a ready state whose exclusion list is shorter than the excluded count", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 8, unsupported: 1, failed: 1 },
					exclusions: [{ id: 100, reason: "parser returned no sentence" }]
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("refuses a ready state with more exclusions than excluded records", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 10, unsupported: 0, failed: 0 },
					exclusions: [{ id: 100, reason: "parser returned no sentence" }]
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("refuses a duplicate identifier in the exclusion list", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await expect(
			store.publishSyntax({
				writer: begun.writer,
				expectedGeneration: begun.generation,
				syntax: syntaxState({
					coverage: { eligible: 10, indexed: 8, unsupported: 1, failed: 1 },
					exclusions: [
						{ id: 100, reason: "parser returned no sentence" },
						{ id: 100, reason: "parser timed out" }
					]
				})
			})
		).rejects.toBeInstanceOf(InvalidSyntaxCoverageError);
	});

	test("accepts one exclusion per unsupported and failed record", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });
		const syntax = syntaxState({
			coverage: { eligible: 10, indexed: 8, unsupported: 1, failed: 1 },
			exclusions: [
				{ id: 100, reason: "parser returned no sentence" },
				{ id: 101, reason: "parser timed out" }
			]
		});

		const record = await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax
		});

		expect(record.syntax?.status).toBe("ready");
		expect(record.syntax?.exclusions).toHaveLength(2);
	});
});

describe("assertSyntaxReady", () => {
	/** Publish a ready generation with a ready syntax state, and return its identifiers. */
	const publishReady = async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax: syntaxState()
		});
		await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 10
		});

		return { store, generation: begun.generation };
	};

	test("returns the ready syntax state", async () => {
		const { store, generation } = await publishReady();

		const syntax = await store.assertSyntaxReady(generation);

		expect(syntax.status).toBe("ready");
		expect(syntax.coverage).toEqual(syntaxState().coverage);
	});

	test("accepts the expected configuration identifier", async () => {
		const { store, generation } = await publishReady();

		const syntax = await store.assertSyntaxReady(generation, SYNTAX_CONFIGURATION.configId);

		expect(syntax.configuration.configId).toBe(SYNTAX_CONFIGURATION.configId);
	});

	test("rejects a configuration identifier that differs from the persisted one", async () => {
		const { store, generation } = await publishReady();

		await expect(store.assertSyntaxReady(generation, "other-config")).rejects.toBeInstanceOf(
			SyntaxNotReadyError
		);
	});

	test("rejects a generation with no syntax state", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 1
		});

		await expect(store.assertSyntaxReady(begun.generation)).rejects.toMatchObject({
			name: "SyntaxNotReadyError",
			reason: "missing"
		});
	});

	test("rejects a pending syntax state", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await store.publishSyntax({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			syntax: syntaxState({
				status: "pending",
				coverage: { eligible: 10, indexed: 0, unsupported: 0, failed: 0 }
			})
		});

		await expect(store.assertSyntaxReady(begun.generation)).rejects.toMatchObject({
			name: "SyntaxNotReadyError",
			reason: "pending"
		});
	});

	test("rejects a changed generation", async () => {
		const { store, generation } = await publishReady();

		await expect(store.assertSyntaxReady(`${generation}-old`)).rejects.toBeInstanceOf(
			StaleGenerationError
		);
	});

	test("keeps assertReady independent of the syntax state", async () => {
		const { dependencies } = createMemoryDependencies();
		const store = createIndexStateStore("state.json", dependencies);
		const begun = await store.beginRebuild({ writer: "writer-a" });

		await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 1
		});

		const record = await store.assertReady(begun.generation);

		expect(record.generation).toBe(begun.generation);
		expect(record.syntax).toBeUndefined();
	});
});
