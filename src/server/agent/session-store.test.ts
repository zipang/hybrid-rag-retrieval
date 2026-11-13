import { describe, expect, test } from "bun:test";
import type { WeightedQuery } from "../../lib/retrieval-contract";
import { createSearchSessionStore, type SearchSessionDependencies } from "./session-store";

/** A query binding without its cursor or page size. */
const BINDING: Omit<WeightedQuery, "cursor" | "pageSize"> = {
	text: "sucre",
	weights: { semantic: 1 },
	minScore: 0.5
};

/** Create a store with a fake clock and a deterministic token generator. */
const createTestStore = (options: { maxEntries?: number; ttlMs?: number } = {}, start = 0) => {
	let now = start;
	let counter = 0;
	const dependencies: SearchSessionDependencies = {
		now: () => now,
		randomToken: () => {
			counter += 1;

			return `token-${counter}`;
		}
	};
	const store = createSearchSessionStore(dependencies, options);

	return {
		store,
		advance: (ms: number) => {
			now += ms;
		}
	};
};

describe("createSearchSessionStore", () => {
	test("saves a search and reads it back through its token", () => {
		const { store } = createTestStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "retrieval-1" });

		expect(store.read("s1", token)).toEqual({
			binding: BINDING,
			pageSize: 5,
			cursor: "retrieval-1"
		});
	});

	test("updates the retrieval cursor after a page is read", () => {
		const { store } = createTestStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "retrieval-1" });

		store.update("s1", token, "retrieval-2");

		expect(store.read("s1", token)?.cursor).toBe("retrieval-2");
	});

	test("clears the cursor when the last page is read", () => {
		const { store } = createTestStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "retrieval-1" });

		store.update("s1", token, undefined);

		expect(store.read("s1", token)?.cursor).toBeUndefined();
	});

	test("returns undefined for a token from another session", () => {
		const { store } = createTestStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5 });

		expect(store.read("s2", token)).toBeUndefined();
	});

	test("returns undefined for an unknown token", () => {
		const { store } = createTestStore();

		expect(store.read("s1", "does-not-exist")).toBeUndefined();
	});

	test("returns undefined for an expired token", () => {
		const { store, advance } = createTestStore({ ttlMs: 1000 });
		const token = store.save("s1", { binding: BINDING, pageSize: 5 });

		advance(1001);

		expect(store.read("s1", token)).toBeUndefined();
	});

	test("keeps a token valid until its lifetime ends", () => {
		const { store, advance } = createTestStore({ ttlMs: 1000 });
		const token = store.save("s1", { binding: BINDING, pageSize: 5 });

		advance(999);

		expect(store.read("s1", token)).toBeDefined();
	});

	test("does not update a token from another session", () => {
		const { store } = createTestStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "retrieval-1" });

		store.update("s2", token, "hijacked");

		expect(store.read("s1", token)?.cursor).toBe("retrieval-1");
	});

	test("bounds the entry count without changing the content of a valid token", () => {
		const { store } = createTestStore({ maxEntries: 2 });
		const first = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "a" });
		const second = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "b" });

		expect(store.read("s1", first)).toEqual({ binding: BINDING, pageSize: 5, cursor: "a" });
		expect(store.read("s1", second)).toEqual({ binding: BINDING, pageSize: 5, cursor: "b" });
	});

	test("evicts the oldest entry when the bound is reached", () => {
		const { store } = createTestStore({ maxEntries: 1 });
		const first = store.save("s1", { binding: BINDING, pageSize: 5 });
		const second = store.save("s1", { binding: BINDING, pageSize: 5 });

		expect(store.read("s1", first)).toBeUndefined();
		expect(store.read("s1", second)).toBeDefined();
	});
});

describe("createSearchSessionStore clear", () => {
	test("drops every search owned by the session", () => {
		const { store } = createTestStore();
		const first = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "a" });
		const second = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "b" });

		store.clear("s1");

		expect(store.read("s1", first)).toBeUndefined();
		expect(store.read("s1", second)).toBeUndefined();
	});

	test("keeps a search owned by another session", () => {
		const { store } = createTestStore();
		const mine = store.save("s1", { binding: BINDING, pageSize: 5 });
		const other = store.save("s2", { binding: BINDING, pageSize: 5 });

		store.clear("s1");

		expect(store.read("s1", mine)).toBeUndefined();
		expect(store.read("s2", other)).toBeDefined();
	});

	test("is a no-op for a session that saved nothing", () => {
		const { store } = createTestStore();
		const other = store.save("s2", { binding: BINDING, pageSize: 5 });

		expect(() => store.clear("s1")).not.toThrow();
		expect(store.read("s2", other)).toBeDefined();
	});
});

describe("createSearchSessionStore default token", () => {
	test("is an opaque base64url string that never contains a colon or whitespace", () => {
		const store = createSearchSessionStore();
		const token = store.save("s1", { binding: BINDING, pageSize: 5, cursor: "0" });

		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token).not.toContain(":");
		expect(token).not.toMatch(/\s/);
		expect(token).not.toBe("0");
	});
});
