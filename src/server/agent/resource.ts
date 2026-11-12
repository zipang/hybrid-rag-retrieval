/**
 * Agent resources: the durable instructions of an agent, as data.
 *
 * An agent is a Markdown document with a YAML frontmatter, living in the agent directory
 * (`AGENTS_DIR`, default `agents/`). It is loaded at runtime, never hard-coded in TypeScript, never
 * imported, and never bundled. The per-session cache reads a resource once for each chat session.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One agent resource: a Markdown document with a YAML frontmatter. */
export type AgentResource = {
	/** Identifier, from the file name without `.md`. */
	id: string;
	/** Short description from the frontmatter, for listing. */
	description: string;
	/** Response language code from the frontmatter, for example `fr`. */
	language: string;
	/** The Markdown body, used verbatim as the system prompt. */
	instructions: string;
};

/** Listing form of a resource, without the body. */
export type AgentResourceSummary = Pick<AgentResource, "id" | "description" | "language">;

/** In-memory cache of the agent loaded for each chat session. */
export type AgentSessionCache = {
	/** Return the resource for one session, loading it once per session. */
	get: (sessionId: string, agentId: string) => AgentResource;
};

/** The level-two sections every resource body must hold, in order. */
const REQUIRED_SECTIONS = ["Role", "Workflow", "Tool rules", "Answer format", "Budget"] as const;

/** An agent id is a lowercase slug: it can never contain a path separator. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Default maximum number of sessions kept by the agent cache. */
const DEFAULT_MAX_SESSIONS = 256;

/** One level-two section of a resource body. */
type Section = {
	/** Heading name, without the leading `##`. */
	name: string;
	/** Body text between this heading and the next. */
	body: string;
	/** Zero-based position among the level-two headings. */
	order: number;
};

/** Read the agent directory from the environment. */
const agentsDir = (): string => process.env.AGENTS_DIR ?? "agents";

/**
 * Reject an id that is not a lowercase slug.
 *
 * The check runs before any file is read, so a traversal id such as `../README` never reaches the
 * filesystem. The message names the id only.
 */
const assertValidId = (id: string): void => {
	if (!ID_PATTERN.test(id)) {
		throw new Error(`Invalid agent id "${id}": an id must match ${String(ID_PATTERN)}.`);
	}
};

/** Split the frontmatter from the Markdown body. */
const splitFrontmatter = (text: string): { frontmatter: Record<string, unknown>; body: string } => {
	const lines = text.split("\n");

	if (lines[0]?.trim() !== "---") {
		throw new Error(
			"The agent resource has no YAML frontmatter (a leading '---' line is required)."
		);
	}

	let end = -1;

	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index]?.trim() === "---") {
			end = index;
			break;
		}
	}

	if (end === -1) {
		throw new Error("The agent resource frontmatter is not closed by a '---' line.");
	}

	const parsed = Bun.YAML.parse(lines.slice(1, end).join("\n"));

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("The agent resource frontmatter must be a YAML mapping.");
	}

	const body = lines
		.slice(end + 1)
		.join("\n")
		.replace(/^\n/, "");

	return { frontmatter: parsed as Record<string, unknown>, body };
};

/** Read one required non-empty string field from the frontmatter, trimmed. */
const readRequiredString = (frontmatter: Record<string, unknown>, key: string): string => {
	const value = frontmatter[key];

	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`The agent resource frontmatter is missing the required "${key}" field.`);
	}

	return value.trim();
};

/** Split a resource body into its level-two sections, in order. */
const parseSections = (text: string): Section[] => {
	const sections: Section[] = [];
	let current: Section | undefined;

	for (const line of text.split("\n")) {
		const match = /^##\s+(.+?)\s*$/.exec(line);

		if (match !== null) {
			current = { name: match[1] ?? "", body: "", order: sections.length };
			sections.push(current);
			continue;
		}

		if (current !== undefined) {
			current.body += `${line}\n`;
		}
	}

	return sections;
};

/** Throw when a required section is missing, out of order, or empty. */
const validateBody = (text: string): void => {
	const sections = parseSections(text);
	let previous = -1;

	for (const name of REQUIRED_SECTIONS) {
		const section = sections.find((candidate) => candidate.name === name);

		if (section === undefined) {
			throw new Error(`Missing required section "## ${name}" in the agent resource.`);
		}

		if (section.order <= previous) {
			throw new Error(`Section "## ${name}" is out of order in the agent resource.`);
		}

		if (section.body.trim() === "") {
			throw new Error(`Section "## ${name}" is empty in the agent resource.`);
		}

		previous = section.order;
	}
};

/**
 * Parse one resource from its id and full text.
 *
 * @param id - Identifier, from the file name without `.md`.
 * @param text - The full document, frontmatter included.
 * @returns The parsed resource.
 * @throws When the frontmatter or the body is invalid.
 */
export const parseAgentResource = (id: string, text: string): AgentResource => {
	assertValidId(id);

	const { frontmatter, body } = splitFrontmatter(text);
	const description = readRequiredString(frontmatter, "description");
	const language = readRequiredString(frontmatter, "language");

	validateBody(body);

	return { id, description, language, instructions: body };
};

/**
 * Read one resource from the agent directory.
 *
 * The id is validated before any file is read, so a path-traversal id is rejected. The missing-file
 * error names the id only, never a filesystem path.
 *
 * @param id - Identifier, from the file name without `.md`.
 * @returns The parsed resource.
 * @throws When the id is invalid, the file is missing, or its content is invalid.
 */
export const loadAgentResource = (id: string): AgentResource => {
	assertValidId(id);

	let text: string;

	try {
		text = readFileSync(join(agentsDir(), `${id}.md`), "utf8");
	} catch {
		throw new Error(`The agent resource "${id}" was not found.`);
	}

	return parseAgentResource(id, text);
};

/**
 * List the available resources, sorted by id.
 *
 * @returns One summary per `.md` file in the agent directory.
 */
export const listAgentResources = (): AgentResourceSummary[] =>
	readdirSync(agentsDir(), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name.slice(0, -3))
		.sort()
		.map((id) => {
			const resource = loadAgentResource(id);

			return {
				id: resource.id,
				description: resource.description,
				language: resource.language
			};
		});

/**
 * Create a per-session agent cache over a loader.
 *
 * The first `get` for a session loads the resource; a later `get` for the same session and agent
 * returns the cached resource. A new session loads again, and a new agent id for a session replaces
 * the cached resource. The cache keeps at most `maxSessions` sessions, evicting the least recently
 * used one; the bound never changes which resource a valid session resolves.
 *
 * @param load - Load one resource by id.
 * @param options - Cache bounds. `maxSessions` defaults to `DEFAULT_MAX_SESSIONS`.
 * @returns The cache.
 */
export const createAgentSessionCache = (
	load: (id: string) => AgentResource,
	options: { maxSessions?: number } = {}
): AgentSessionCache => {
	const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
	const bySession = new Map<string, { agentId: string; resource: AgentResource }>();

	return {
		get: (sessionId, agentId) => {
			const cached = bySession.get(sessionId);

			if (cached !== undefined && cached.agentId === agentId) {
				// Refresh recency, so the oldest entry is the least recently used.
				bySession.delete(sessionId);
				bySession.set(sessionId, cached);

				return cached.resource;
			}

			const resource = load(agentId);

			if (cached !== undefined) {
				bySession.delete(sessionId);
			} else if (bySession.size >= maxSessions) {
				const oldest = bySession.keys().next().value;

				if (oldest !== undefined) {
					bySession.delete(oldest);
				}
			}

			bySession.set(sessionId, { agentId, resource });

			return resource;
		}
	};
};
