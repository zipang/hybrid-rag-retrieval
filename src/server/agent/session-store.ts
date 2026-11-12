/**
 * Per-conversation search session store.
 *
 * A conversation continues a search through an opaque token. The token maps to one cached search:
 * the query binding and the retrieval cursor. The store is bounded by an entry count and a
 * time-to-live, so a long-running server never grows without limit. The bound never changes the
 * records a valid token returns; it only decides which tokens stay valid.
 *
 * The clock and the token generator are injected, so a test is hermetic.
 */

import type { WeightedQuery } from "../../lib/retrieval-contract";

/** One cached search that a conversation can continue. */
export type CachedSearch = {
	/** The weighted query without its cursor. Re-supplied on every page. */
	binding: Omit<WeightedQuery, "cursor" | "pageSize">;
	/** Delivery size chosen by the originating search. */
	pageSize: number;
	/** The retrieval cursor for the next page, or `undefined` when exhausted. */
	cursor?: string;
};

/** In-memory store of the searches that a conversation can continue. */
export type SearchSessionStore = {
	/** Cache one search for a session and return its opaque token. */
	save: (sessionId: string, search: CachedSearch) => string;
	/** Read one cached search. Returns `undefined` for an unknown, foreign, or expired token. */
	read: (sessionId: string, token: string) => CachedSearch | undefined;
	/** Replace the cached retrieval cursor after a page is read. */
	update: (sessionId: string, token: string, cursor: string | undefined) => void;
};

/** Dependencies of the session store. Tests inject a clock and a token source. */
export type SearchSessionDependencies = {
	/** Generate a unique, opaque token. */
	randomToken: () => string;
	/** Current time in milliseconds since the epoch. */
	now: () => number;
};

/** Bounds of the session store. */
export type SearchSessionOptions = {
	/** Maximum number of cached searches kept. Defaults to `DEFAULT_MAX_ENTRIES`. */
	maxEntries?: number;
	/** Cached search lifetime in milliseconds. Defaults to `DEFAULT_TTL_MS`. */
	ttlMs?: number;
};

/** Default maximum number of cached searches. */
const DEFAULT_MAX_ENTRIES = 256;

/** Default cached search lifetime in minutes converted to milliseconds. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** One stored search with its owner and its last access time. */
type Entry = {
	/** Conversation that owns the token. */
	sessionId: string;
	/** The cached search. */
	search: CachedSearch;
	/** Last access time in milliseconds since the epoch. */
	lastAccessAt: number;
};

/** Read the default dependencies from the runtime. */
const defaultDependencies = (): SearchSessionDependencies => ({
	randomToken: () => Buffer.from(crypto.randomUUID(), "utf8").toString("base64url"),
	now: () => Date.now()
});

/** Copy a cached search so a caller cannot mutate the stored entry. */
const copySearch = (search: CachedSearch): CachedSearch => ({
	binding: { ...search.binding },
	pageSize: search.pageSize,
	...(search.cursor === undefined ? {} : { cursor: search.cursor })
});

/**
 * Create a bounded, in-memory search session store.
 *
 * @param dependencies - Clock and token generator. Defaults to the runtime.
 * @param options - Entry-count and lifetime bounds. Defaults are documented on
 *   {@link SearchSessionOptions}.
 * @returns The store.
 */
export const createSearchSessionStore = (
	dependencies: SearchSessionDependencies = defaultDependencies(),
	options: SearchSessionOptions = {}
): SearchSessionStore => {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const entries = new Map<string, Entry>();

	/** Drop every expired entry. */
	const prune = (): void => {
		const now = dependencies.now();

		for (const [token, entry] of entries) {
			if (now - entry.lastAccessAt > ttlMs) {
				entries.delete(token);
			}
		}
	};

	/** Cache one search and return its opaque token. */
	const save = (sessionId: string, search: CachedSearch): string => {
		prune();

		if (entries.size >= maxEntries) {
			const oldest = [...entries.entries()].sort(
				([, left], [, right]) => left.lastAccessAt - right.lastAccessAt
			)[0];

			if (oldest !== undefined) {
				entries.delete(oldest[0]);
			}
		}

		const token = dependencies.randomToken();

		entries.set(token, {
			sessionId,
			search: copySearch(search),
			lastAccessAt: dependencies.now()
		});

		return token;
	};

	/** Read a cached search owned by the session, or `undefined`. */
	const read = (sessionId: string, token: string): CachedSearch | undefined => {
		prune();

		const entry = entries.get(token);

		if (entry === undefined || entry.sessionId !== sessionId) {
			return undefined;
		}

		entry.lastAccessAt = dependencies.now();

		return copySearch(entry.search);
	};

	/** Replace the retrieval cursor of a cached search owned by the session. */
	const update = (sessionId: string, token: string, cursor: string | undefined): void => {
		prune();

		const entry = entries.get(token);

		if (entry === undefined || entry.sessionId !== sessionId) {
			return;
		}

		entry.search = copySearch({
			binding: entry.search.binding,
			pageSize: entry.search.pageSize,
			...(cursor === undefined ? {} : { cursor })
		});
		entry.lastAccessAt = dependencies.now();
	};

	return { save, read, update };
};
