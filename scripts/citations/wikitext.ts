/**
 * Wikitext parsing helpers for the Wikiquote citation extractor.
 *
 * The functions in this module are pure: they take a wikitext fragment or a
 * full page and return cleaned text or structured templates. The build script
 * in `scripts/build-citations.ts` orchestrates the I/O.
 */

/** A raw `{{...}}` template invocation found in a wikitext fragment. */
export type RawTemplate = {
	/** Lower-cased template name, for example `citation` or `réf livre`. */
	name: string
	/** Positional parameters in source order, with `key=value` entries removed. */
	positional: string[]
	/** Named parameters, keyed by their lower-cased, trimmed name. */
	named: Map<string, string>
	/** Character offset of the opening `{{` in the source string. */
	start: number
	/** Character offset just after the closing `}}` in the source string. */
	end: number
}

/** A citation extracted from a Wikiquote page, before schema validation. */
export type RawCitation = {
	/** Author of the quoted work, or the page author when the source omits it. */
	author: string
	/** Title of the work that contains the quote. */
	work: string
	/** Publication year of the work, or `undefined` when the source omits it. */
	year: number | undefined
	/** Lower-case language code of the wiki that provided the quote. */
	lang: "fr" | "en"
	/** Translator credit when the source names one. */
	trad: string
	/** Cleaned citation text. */
	quote: string
}

/** Replace the XML character entities that MediaWiki emits in text nodes. */
export const unescapeXml = (value: string): string => {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ")
}

/** Remove HTML comments and `<ref>` blocks from a wikitext fragment. */
export const stripComments = (value: string): string => {
	return value
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<ref\b[^>]*\/>/gi, "")
		.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
}

/** Convert block and line-break HTML tags to spaces and drop other tags. */
export const stripHtmlTags = (value: string): string => {
	return value
		.replace(/<\/?(?:poem|blockquote|div|center|p|br|hr)\b[^>]*>/gi, " ")
		.replace(/<nowiki\b[^>]*>([\s\S]*?)<\/nowiki>/gi, "$1")
		.replace(/<[^>]+>/g, " ")
}

/** Remove links, keeping the display label, and drop file and category links. */
export const stripLinks = (value: string): string => {
	return value
		.replace(/\[\[(?:File|Image|Fichier|Catégorie|Category)\s*:[^[\]]*\]\]/gi, "")
		.replace(/\[\[(?:[^\]|]*)\|([^\]|]*)\]\]/g, "$1")
		.replace(/\[\[([^\]|]*)\]\]/g, "$1")
}

/** Remove bold and italic apostrophe markers from a wikitext fragment. */
export const stripEmphasis = (value: string): string => {
	return value.replace(/'{2,5}/g, "")
}

/** Split a string on a delimiter that sits outside `{{...}}` and `[[...]]`. */
export const splitTopLevel = (value: string, delimiter: string): string[] => {
	const parts: string[] = []
	let curlyDepth = 0
	let squareDepth = 0
	let current = ""

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index]
		const next = value[index + 1]

		if (char === "{" && next === "{") {
			curlyDepth += 1
			current += "{{"
			index += 1
			continue
		}

		if (char === "}" && next === "}") {
			curlyDepth -= 1
			current += "}}"
			index += 1
			continue
		}

		if (char === "[" && next === "[") {
			squareDepth += 1
			current += "[["
			index += 1
			continue
		}

		if (char === "]" && next === "]") {
			squareDepth -= 1
			current += "]]"
			index += 1
			continue
		}

		if (char === delimiter && curlyDepth <= 0 && squareDepth <= 0) {
			parts.push(current)
			current = ""
			continue
		}

		current += char
	}

	parts.push(current)

	return parts
}

/** Turn a parameter list into named and positional values. */
export const parseTemplateParams = (
	params: string[],
): Pick<RawTemplate, "named" | "positional"> => {
	const named = new Map<string, string>()
	const positional: string[] = []

	for (const raw of params) {
		const equals = raw.indexOf("=")

		if (equals === -1) {
			positional.push(raw.trim())
			continue
		}

		const key = raw.slice(0, equals).trim().toLowerCase()
		const value = raw.slice(equals + 1).trim()

		if (key.length === 0 || key.includes("{{") || key.includes("[[")) {
			positional.push(raw.trim())
			continue
		}

		named.set(key, value)
	}

	return { named, positional }
}

/** Extract every top-level `{{...}}` template invocation from a fragment. */
export const extractTemplates = (value: string): RawTemplate[] => {
	const templates: RawTemplate[] = []
	let index = 0

	while (index < value.length) {
		if (value[index] !== "{" || value[index + 1] !== "{") {
			index += 1
			continue
		}

		const start = index
		let depth = 0
		let cursor = index
		let end = -1

		while (cursor < value.length) {
			if (value[cursor] === "{" && value[cursor + 1] === "{") {
				depth += 1
				cursor += 2
				continue
			}

			if (value[cursor] === "}" && value[cursor + 1] === "}") {
				depth -= 1
				cursor += 2

				if (depth === 0) {
					end = cursor
					break
				}

				continue
			}

			cursor += 1
		}

		if (end === -1) {
			break
		}

		const inner = value.slice(start + 2, end - 2)
		const parts = splitTopLevel(inner, "|")
		const name = stripEmphasis(parts[0]).trim().toLowerCase()
		const { named, positional } = parseTemplateParams(parts.slice(1))

		templates.push({ name, positional, named, start, end })
		index = end
	}

	return templates
}

/** Render an inline template to its visible text, or drop it when useless. */
const renderInlineTemplate = (template: RawTemplate): string => {
	const name = template.name

	if (
		name === "w" ||
		name === "wp" ||
		name === "wikipedia" ||
		name === "wikipédia" ||
		name === "lien"
	) {
		return template.positional.at(-1) ?? template.named.get("1") ?? ""
	}

	if (name === "lang" || name === "langue" || name === "langue de") {
		return template.positional.at(-1) ?? ""
	}

	if (
		name === "date" ||
		name === "date-" ||
		name === "nobr" ||
		name === "nowrap" ||
		name === "small"
	) {
		return template.positional.join(" ")
	}

	if (name === "citation" || name === "ref" || name === "réf" || name === "sfn") {
		return (
			template.named.get("citation") ?? template.named.get("texte") ?? template.positional.join(" ")
		)
	}

	return ""
}

/** Replace inline templates with their text, innermost template first. */
export const unwrapInlineTemplates = (value: string): string => {
	let current = value
	const pattern = /\{\{([^{}]*)\}\}/

	for (let pass = 0; pass < 50; pass += 1) {
		const match = pattern.exec(current)

		if (match === null) {
			break
		}

		const inner = splitTopLevel(match[1], "|")
		const name = stripEmphasis(inner[0]).trim().toLowerCase()
		const { named, positional } = parseTemplateParams(inner.slice(1))
		const rendered = renderInlineTemplate({ name, named, positional, start: 0, end: 0 })

		current =
			current.slice(0, match.index) + rendered + current.slice(match.index + match[0].length)
	}

	return current
}

/** Clean a wikitext fragment into plain prose with collapsed whitespace. */
export const cleanText = (value: string): string => {
	const withoutMarkup = unwrapInlineTemplates(
		stripEmphasis(stripLinks(stripHtmlTags(unescapeXml(stripComments(value))))),
	)

	return withoutMarkup
		.replace(/\[\[[^\]]*$/g, " ")
		.replace(/\{\{[^}]*$/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[\s:;,*•·\-–—|/\\]+/u, "")
		.replace(/^["'«“]+/u, "")
		.replace(/["'»”]+$/u, "")
		.trim()
}

/** Return true when a cleaned fragment still carries unresolved markup. */
export const hasResidualMarkup = (value: string): boolean => {
	return /\{\{|\}\}|\[\[|\]\]/.test(value)
}

/** Extract the first four-digit year in the inclusive range 800 to 2100. */
export const firstYear = (value: string): number | undefined => {
	const match = /\b(8\d{2}|9\d{2}|1\d{3}|20\d{2})\b/.exec(value)

	return match === null ? undefined : Number(match[1])
}

/** Collect every plausible year from a set of named parameters. */
export const yearsFromParams = (named: Map<string, string>): number[] => {
	const years: number[] = []

	for (const [key, value] of named) {
		if (!/ann[ée]e|parution|date|origine|contribution/.test(key)) {
			continue
		}

		const year = firstYear(value)

		if (year !== undefined) {
			years.push(year)
		}
	}

	return years
}

/** Pick the most likely original publication year from template parameters. */
export const pickWorkYear = (named: Map<string, string>): number | undefined => {
	const preferredKeys = ["année d'origine", "année de la contribution", "date", "parution", "année"]

	for (const key of preferredKeys) {
		const value = named.get(key)
		const year = value === undefined ? undefined : firstYear(value)

		if (year !== undefined) {
			return year
		}
	}

	const years = yearsFromParams(named)

	return years.length === 0 ? undefined : Math.min(...years)
}
