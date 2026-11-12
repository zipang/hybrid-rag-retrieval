import { StaleGenerationError, SyntaxNotReadyError } from "../lib/index-state";
import type { IndexScores, IndexWeights, WeightedHit } from "../lib/retrieval-contract";
import {
	CursorExpiredError,
	CursorMismatchError,
	SnapshotCapacityError
} from "../lib/result-pages";
import type { WeightedRetriever } from "../lib/retrieval";
import { validateWeights } from "../lib/scoring";
import { ParserUnavailableError } from "../lib/syntax/parser";

/** Payload field names that map one weighted hit to a typed response record. */
export type SloganFields = {
	/** Numeric field for the year output. */
	year: string;
	/** String field for the brand output. */
	brand: string;
	/** String field for the campaign output. */
	campaign: string;
	/** String field for the slogan output. */
	content: string;
};

/** Dependencies of the JSON API. Tests inject a fake retriever. */
export type ApiDependencies = {
	/** Weighted retriever over the slogan collection. */
	retriever: Pick<WeightedRetriever, "retrieveWeighted">;
	/** Payload field names for the typed response. */
	fields: SloganFields;
};

/** One typed slogan record in a weighted response. */
export type SloganRecord = {
	/** Record identifier. */
	id: number | string;
	/** Combined matching score. */
	score: number;
	/** Selected per-index component scores. */
	scores: IndexScores;
	/** Publication year. */
	annee: number;
	/** Brand or issuing organization. */
	marque: string;
	/** Campaign. */
	campagne: string;
	/** Slogan text. */
	slogan: string;
};

/** Error with an HTTP status for the JSON API. */
export class ApiError extends Error {
	/** HTTP status code. */
	readonly status: number;

	/** Create an API error with a status and a client message. */
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** CORS headers for the JSON API. */
export const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "content-type"
};

/** Build a JSON response with the CORS headers. */
export const jsonResponse = (body: unknown, status = 200): Response =>
	Response.json(body, { status, headers: CORS_HEADERS });

/** Query parameters that the weighted contract replaced. */
const OBSOLETE_PARAMETERS = ["topK", "mode", "yearFrom", "yearTo"] as const;

/** Reject a request that still carries an obsolete parameter. */
const rejectObsolete = (params: URLSearchParams): void => {
	for (const name of OBSOLETE_PARAMETERS) {
		if (params.has(name)) {
			throw new ApiError(
				400,
				`Query parameter "${name}" is obsolete and no longer accepted.`
			);
		}
	}
};

/**
 * Read the required `weights` parameter as an {@link IndexWeights} object.
 *
 * The handler never normalizes invalid weights and never supplies a hidden default. A non-JSON
 * value, a non-object value, or a value that fails {@link validateWeights} is a 400.
 */
const readWeights = (params: URLSearchParams): IndexWeights => {
	const raw = params.get("weights");

	if (raw === null || raw.trim() === "") {
		throw new ApiError(400, 'Query parameter "weights" is required.');
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ApiError(400, 'Query parameter "weights" must be a JSON object.');
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ApiError(400, 'Query parameter "weights" must be a JSON object.');
	}

	const validation = validateWeights(parsed as IndexWeights);

	if (!validation.valid) {
		throw new ApiError(400, `Query parameter "weights" is invalid: ${validation.reason}.`);
	}

	return parsed as IndexWeights;
};

/** Read the required `minScore` parameter as a finite number in `[0, 1]`. */
const readMinScore = (params: URLSearchParams): number => {
	const raw = params.get("minScore");

	if (raw === null || raw.trim() === "") {
		throw new ApiError(400, 'Query parameter "minScore" is required.');
	}

	const value = Number(raw);

	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new ApiError(400, 'Query parameter "minScore" must be a finite number in [0, 1].');
	}

	return value;
};

/** Read the optional `pageSize` parameter as a positive integer. */
const readPageSize = (params: URLSearchParams): number | undefined => {
	const raw = params.get("pageSize");

	if (raw === null || raw.trim() === "") {
		return undefined;
	}

	const value = Number(raw);

	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new ApiError(400, 'Query parameter "pageSize" must be a positive integer.');
	}

	return value;
};

/** Read one payload value as a number. */
const readNumber = (value: unknown): number =>
	typeof value === "number" ? value : Number(value ?? 0);

/** Read one payload value as a string. */
const readString = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}

	return value === undefined || value === null ? "" : String(value);
};

/** Map one weighted hit to a typed slogan record through the field configuration. */
const toRecord = (hit: WeightedHit, fields: SloganFields): SloganRecord => ({
	id: hit.id,
	score: hit.score,
	scores: hit.scores,
	annee: readNumber(hit.payload[fields.year]),
	marque: readString(hit.payload[fields.brand]),
	campagne: readString(hit.payload[fields.campaign]),
	slogan: readString(hit.payload[fields.content])
});

/** Map a thrown error to the documented HTTP status and JSON body. */
const errorResponse = (error: unknown): Response => {
	if (error instanceof ApiError) {
		return jsonResponse({ error: error.message }, error.status);
	}

	if (error instanceof CursorMismatchError) {
		return jsonResponse({ error: error.message }, 400);
	}

	if (error instanceof SnapshotCapacityError) {
		return jsonResponse({ error: error.message }, 503);
	}

	if (error instanceof StaleGenerationError) {
		return jsonResponse({ error: error.message }, 409);
	}

	if (error instanceof CursorExpiredError) {
		return jsonResponse({ error: error.message }, 410);
	}

	if (error instanceof SyntaxNotReadyError) {
		return jsonResponse({ error: error.message }, 503);
	}

	if (error instanceof ParserUnavailableError) {
		return jsonResponse({ error: error.message }, 503);
	}

	const message = error instanceof Error ? error.message : "Unexpected error.";

	return jsonResponse({ error: message }, 500);
};

/**
 * Create the `GET /api/slogans` handler.
 *
 * The handler reads `q`, `weights`, `minScore`, `pageSize`, and `cursor`, then calls the weighted
 * retriever. It rejects every obsolete parameter with a 400, answers OPTIONS preflight requests,
 * and maps every thrown error to a JSON response with a status code.
 */
export const createSlogansHandler = (dependencies: ApiDependencies) => {
	return async (request: Request): Promise<Response> => {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: CORS_HEADERS
				});
			}

			if (request.method !== "GET") {
				throw new ApiError(405, "Method not allowed.");
			}

			const params = new URL(request.url).searchParams;

			rejectObsolete(params);

			const query = (params.get("q") ?? "").trim();

			if (query === "") {
				throw new ApiError(400, 'Query parameter "q" is required.');
			}

			const weights = readWeights(params);
			const minScore = readMinScore(params);
			const pageSize = readPageSize(params);
			const cursor = params.get("cursor") ?? undefined;

			const page = await dependencies.retriever.retrieveWeighted({
				text: query,
				weights,
				minScore,
				...(pageSize === undefined ? {} : { pageSize }),
				...(cursor === undefined ? {} : { cursor })
			});

			const results = page.results.map((hit) => toRecord(hit, dependencies.fields));

			return jsonResponse({
				results,
				...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
				metadata: page.metadata
			});
		} catch (error) {
			return errorResponse(error);
		}
	};
};
