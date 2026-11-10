import { describe, expect, test } from "bun:test";
import {
	datasetStatePath,
	type DenseIndexIdentity,
	denseIndexConfigId,
	denseIndexIdentity
} from "./index-config";

/** Identity used by the fingerprint tests. */
const baseIdentity = (): DenseIndexIdentity => denseIndexIdentity("slogans", {}, 1024);

describe("denseIndexConfigId", () => {
	test("returns a stable 16-character hexadecimal id for the same identity", async () => {
		const first = await denseIndexConfigId(baseIdentity());
		const second = await denseIndexConfigId(baseIdentity());

		expect(first).toBe(second);
		expect(first).toMatch(/^[0-9a-f]{16}$/);
	});

	test("changes when any identity field changes", async () => {
		const base = await denseIndexConfigId(baseIdentity());
		const variants: Record<keyof DenseIndexIdentity, DenseIndexIdentity> = {
			dataset: { ...baseIdentity(), dataset: "citations" },
			collection: { ...baseIdentity(), collection: "another-collection" },
			provider: { ...baseIdentity(), provider: "remote" },
			model: { ...baseIdentity(), model: "BAAI/bge-small-en-v1.5" },
			maxLength: { ...baseIdentity(), maxLength: 64 },
			dimensions: { ...baseIdentity(), dimensions: 384 },
			bm25: { ...baseIdentity(), bm25: { language: "french" } }
		};

		for (const [field, identity] of Object.entries(variants)) {
			expect(await denseIndexConfigId(identity), field).not.toBe(base);
		}
	});

	test("ignores the insertion order of the keys", async () => {
		const ordered: DenseIndexIdentity = {
			dataset: "slogans",
			collection: "slogans",
			provider: "local",
			model: "intfloat/multilingual-e5-large",
			maxLength: 32,
			dimensions: 1024,
			bm25: { language: "french", ascii_folding: true, avg_len: 8 }
		};
		const reordered: DenseIndexIdentity = {
			bm25: { avg_len: 8, ascii_folding: true, language: "french" },
			dimensions: 1024,
			maxLength: 32,
			model: "intfloat/multilingual-e5-large",
			provider: "local",
			collection: "slogans",
			dataset: "slogans"
		};

		expect(await denseIndexConfigId(reordered)).toBe(await denseIndexConfigId(ordered));
	});
});

describe("denseIndexIdentity", () => {
	test("reads the defaults from an empty environment", () => {
		expect(denseIndexIdentity("slogans", {}, 1024)).toEqual({
			dataset: "slogans",
			collection: "slogans",
			provider: "local",
			model: "intfloat/multilingual-e5-large",
			maxLength: 32,
			dimensions: 1024,
			bm25: {}
		});
	});

	test("reads the environment overrides", () => {
		const identity = denseIndexIdentity(
			"citations",
			{
				EMBEDDING_PROVIDER: "remote",
				EMBEDDING_MODEL: "BAAI/bge-small-en-v1.5",
				EMBEDDING_MAX_LENGTH: "128",
				BM25_LANGUAGE: "french",
				BM25_ASCII_FOLDING: "true",
				BM25_AVG_LEN: "12"
			},
			384
		);

		expect(identity).toEqual({
			dataset: "citations",
			collection: "citations",
			provider: "remote",
			model: "BAAI/bge-small-en-v1.5",
			maxLength: 128,
			dimensions: 384,
			bm25: { language: "french", ascii_folding: true, avg_len: 12 }
		});
	});
});

describe("datasetStatePath", () => {
	test("keeps the legacy path for the slogan dataset", () => {
		expect(datasetStatePath("slogans")).toBe("data/index-state.json");
	});

	test("gives every other dataset its own state file", () => {
		expect(datasetStatePath("citations")).toBe("data/index-state.citations.json");
	});
});
