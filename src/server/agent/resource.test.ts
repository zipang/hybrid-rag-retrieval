import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_STEPS } from "./agent";
import {
	createAgentSessionCache,
	listAgentResources,
	loadAgentResource,
	parseAgentResource
} from "./resource";

/** Absolute path of the committed agent directory, independent of the cwd. */
const COMMITTED_AGENTS_DIR = new URL("../../../agents", import.meta.url).pathname;

/** A temporary directory of fixture resources, created once for the file. */
let fixtureDir: string;

/** The agent directory in effect before a test, restored after it. */
let previousDir: string | undefined;

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "agents-fixture-"));
	writeFileSync(
		join(fixtureDir, "alpha.md"),
		resourceText("Alpha agent.", "fr", "It answers about slogans.")
	);
	writeFileSync(
		join(fixtureDir, "beta.md"),
		resourceText("Beta agent.", "en", "It answers about anything.")
	);
});

afterAll(() => {
	rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
	previousDir = process.env.AGENTS_DIR;
});

afterEach(() => {
	if (previousDir === undefined) {
		delete process.env.AGENTS_DIR;
	} else {
		process.env.AGENTS_DIR = previousDir;
	}
});

/** Build a valid resource text with the five required sections in order. */
const resourceText = (description: string, language: string, role: string): string =>
	[
		"---",
		`description: ${description}`,
		`language: ${language}`,
		"---",
		"",
		"# Fixture",
		"",
		"## Role",
		"",
		role,
		"",
		"## Workflow",
		"",
		"Call searchRecords.",
		"",
		"## Tool rules",
		"",
		"Never invent a cursor.",
		"",
		"## Answer format",
		"",
		"Write Markdown.",
		"",
		"## Budget",
		"",
		"At most 6 steps.",
		""
	].join("\n");

/** A minimal resource text that carries the five required sections in order. */
const FIXTURE = resourceText("A test agent.", "fr", "Tu réponds en français.");

/** Read the body of one level-two section. */
const sectionBody = (text: string, name: string): string => {
	const pattern = new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);

	return pattern.exec(text)?.[1] ?? "";
};

describe("parseAgentResource", () => {
	test("parses the frontmatter and returns the body as instructions", () => {
		const resource = parseAgentResource("default", FIXTURE);

		expect(resource.id).toBe("default");
		expect(resource.description).toBe("A test agent.");
		expect(resource.language).toBe("fr");
		expect(resource.instructions).toContain("## Role");
		expect(resource.instructions).not.toContain("description:");
	});

	test("throws when the frontmatter is missing", () => {
		expect(() => parseAgentResource("default", "## Role\n\nx")).toThrow(/frontmatter/i);
	});

	test("throws when description is missing, and names it", () => {
		const text = FIXTURE.replace("description: A test agent.\n", "");

		expect(() => parseAgentResource("default", text)).toThrow(/description/i);
	});

	test("throws when language is missing, and names it", () => {
		const text = FIXTURE.replace("language: fr\n", "");

		expect(() => parseAgentResource("default", text)).toThrow(/language/i);
	});

	test("throws when a required section is missing, and names it", () => {
		const text = FIXTURE.replace(/## Budget[\s\S]*$/, "");

		expect(() => parseAgentResource("default", text)).toThrow(/Budget/);
	});

	test("throws when a required section is empty, and names it", () => {
		const text = FIXTURE.replace("Tu réponds en français.", "");

		expect(() => parseAgentResource("default", text)).toThrow(/Role/);
	});

	test("throws when a required section is out of order", () => {
		const swapped = [
			"---",
			"description: A test agent.",
			"language: fr",
			"---",
			"## Workflow",
			"Appelle searchRecords.",
			"## Role",
			"Tu réponds en français.",
			"## Tool rules",
			"x",
			"## Answer format",
			"y",
			"## Budget",
			"6"
		].join("\n");

		expect(() => parseAgentResource("default", swapped)).toThrow(/out of order/i);
	});

	test("trims the description and language from the frontmatter", () => {
		const text = FIXTURE.replace(
			"description: A test agent.",
			'description: "  A test agent.  "'
		).replace("language: fr", 'language: "  fr  "');
		const resource = parseAgentResource("default", text);

		expect(resource.description).toBe("A test agent.");
		expect(resource.language).toBe("fr");
	});

	test("parses a specialized fixture resource", () => {
		const resource = parseAgentResource(
			"alpha",
			resourceText("A French slogan agent.", "fr", "It answers about slogans.")
		);

		expect(resource.language).toBe("fr");
		expect(resource.instructions).toContain("slogans");
	});
});

describe("agent id validation", () => {
	test("rejects a path-traversal or malformed id before reading any file", () => {
		process.env.AGENTS_DIR = fixtureDir;

		for (const id of ["../README", "a/b", "..", "", "Alpha", "a.b"]) {
			expect(() => loadAgentResource(id)).toThrow(/invalid agent id/i);
		}
	});

	test("names the id only in the rejection, never a filesystem path", () => {
		process.env.AGENTS_DIR = fixtureDir;

		try {
			loadAgentResource("../README");
			throw new Error("expected a rejection");
		} catch (error) {
			const message = (error as Error).message;

			expect(message).toContain("../README");
			expect(message).not.toContain(fixtureDir);
		}
	});

	test("names the id only when the file is missing, never a filesystem path", () => {
		process.env.AGENTS_DIR = fixtureDir;

		try {
			loadAgentResource("missing");
			throw new Error("expected a rejection");
		} catch (error) {
			const message = (error as Error).message;

			expect(message).toContain("missing");
			expect(message).not.toContain("/");
		}
	});
});

describe("loadAgentResource", () => {
	test("loads a resource from the fixture directory", () => {
		process.env.AGENTS_DIR = fixtureDir;

		const resource = loadAgentResource("alpha");

		expect(resource.id).toBe("alpha");
		expect(resource.description).toBe("Alpha agent.");
		expect(resource.language).toBe("fr");
		expect(resource.instructions).toContain("## Role");
	});

	test("throws when the file is missing", () => {
		process.env.AGENTS_DIR = fixtureDir;

		expect(() => loadAgentResource("does-not-exist")).toThrow();
	});
});

describe("listAgentResources", () => {
	test("returns one summary per resource, sorted by id", () => {
		process.env.AGENTS_DIR = fixtureDir;

		const summaries = listAgentResources();

		expect(summaries.map((summary) => summary.id)).toEqual(["alpha", "beta"]);
		expect(summaries.every((summary) => summary.description !== "")).toBe(true);
		expect(summaries.every((summary) => summary.language !== "")).toBe(true);
	});
});

describe("createAgentSessionCache", () => {
	/** Build a cache over a loader that records the ids it is asked for. */
	const createRecordingCache = (options?: { maxSessions?: number }) => {
		const loads: string[] = [];
		const cache = createAgentSessionCache((id) => {
			loads.push(id);

			return { id, description: `d-${id}`, language: "fr", instructions: `body-${id}` };
		}, options);

		return { cache, loads };
	};

	test("loads once per session and returns the cached resource", () => {
		const { cache, loads } = createRecordingCache();

		const first = cache.get("s1", "default");
		const again = cache.get("s1", "default");

		expect(loads).toEqual(["default"]);
		expect(again).toBe(first);
	});

	test("loads again for a different session", () => {
		const { cache, loads } = createRecordingCache();

		cache.get("s1", "default");
		cache.get("s2", "default");

		expect(loads).toEqual(["default", "default"]);
	});

	test("replaces the cached resource when the agent id changes", () => {
		const { cache, loads } = createRecordingCache();

		cache.get("s1", "default");
		const second = cache.get("s1", "citations");

		expect(loads).toEqual(["default", "citations"]);
		expect(second.id).toBe("citations");
	});

	test("bounds the session count without changing a valid session's resource", () => {
		const { cache } = createRecordingCache({ maxSessions: 2 });

		cache.get("s1", "default");
		cache.get("s2", "citations");

		expect(cache.get("s1", "default").id).toBe("default");
		expect(cache.get("s2", "citations").id).toBe("citations");
	});

	test("evicts the oldest session when the bound is reached", () => {
		const { cache, loads } = createRecordingCache({ maxSessions: 1 });

		cache.get("s1", "default");
		cache.get("s2", "citations");
		cache.get("s1", "default");

		expect(loads).toEqual(["default", "citations", "default"]);
	});
});

describe("committed default resource", () => {
	test("loads the committed default, which is generic and matches the budget", () => {
		process.env.AGENTS_DIR = COMMITTED_AGENTS_DIR;

		const resource = loadAgentResource("default");
		const body = resource.instructions.toLowerCase();
		const budget = sectionBody(resource.instructions, "Budget");
		const number = Number.parseInt(/(\d+)/.exec(budget)?.[1] ?? "", 10);

		expect(resource.id).toBe("default");
		expect(resource.description).not.toBe("");
		expect(resource.language).not.toBe("");
		expect(resource.instructions).toContain("## Role");
		expect(body).toContain("the language of the question");
		expect(body).not.toContain("français");
		expect(body).not.toContain("slogan");
		expect(number).toBe(DEFAULT_MAX_STEPS);
	});
});
