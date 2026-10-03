/**
 * French text normalization for the syntax pipeline.
 *
 * The normalizer canonicalizes French punctuation and strips characters that do
 * not belong to the French Latin set. It runs on the raw text before the
 * parser, so two spellings of the same content produce the same tokens.
 *
 * The rules follow the French book-publisher code (`Lexique des règles
 * typographiques en usage à l'Imprimerie nationale`) and the space rules of the
 * OQLF:
 *
 * - NFC-normalize the text.
 * - Turn every typographic space into one ASCII space.
 * - Normalize quotes: curly and straight double quotes become French guillemets
 *   `« »`, typographic apostrophes become the straight apostrophe.
 * - Replace a run of three or more periods with the ellipsis character `…`.
 * - Replace the en dash, the em dash, and the minus sign with the hyphen `-`.
 * - Put a space before `; : ! ?`, and remove the space before `. , ) ] }`.
 * - Keep one space inside the guillemets, as in `« mot »`.
 * - Drop every character outside the French Latin set.
 * - Append a period when the text has no terminal mark.
 */

/** The marks that already end a sentence. */
const TERMINAL_MARKS = new Set([".", "!", "?", "…"])

/** The characters kept by the normalizer: Latin letters, digits, and punctuation. */
const NON_LATIN = /[^A-Za-zÀ-ÖØ-öø-ÿŒœŸ0-9 .,;:!?'"()[\]{}…«»/\\%€$&@#*+=°§_~^|<>-]/g

/** Any kind of space, mapped to one ASCII space. */
const SPACES = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g

/** Opening double quotes, mapped to the French opening guillemet. */
const OPEN_QUOTES = /[“„‟]/g

/** The closing double quote, mapped to the French closing guillemet. */
const CLOSE_QUOTE = /”/g

/** Typographic apostrophes, mapped to the straight apostrophe. */
const APOSTROPHES = /[‘’‚‛´`]/g

/** A run of three or more periods, mapped to the ellipsis character. */
const ELLIPSIS = /\.{3,}/g

/** Dash-like characters, mapped to the ASCII hyphen. */
const DASHES = /[–—‒―−]/g

/**
 * Normalize the quote characters.
 *
 * The function maps the curly quotes to French guillemets and the typographic
 * apostrophes to the straight apostrophe. A straight double quote is symmetric,
 * so the function pairs the occurrences: the first opens, the second closes.
 */
const normalizeQuotes = (text: string): string => {
	const mapped = text.replace(OPEN_QUOTES, "«").replace(CLOSE_QUOTE, "»").replace(APOSTROPHES, "'")
	let open = true

	return mapped.replace(/"/g, () => {
		const mark = open ? "«" : "»"

		open = !open

		return mark
	})
}

/**
 * Normalize the spaces around the punctuation.
 *
 * The function puts a space before the French double punctuation `; : ! ?`,
 * except the numeric colon of a time such as `18:30`. It removes the space
 * before `. , ) ] }`. It keeps one space inside the guillemets.
 */
const normalizeSpacing = (text: string): string =>
	text
		.replace(SPACES, " ")
		.replace(/\s*([;:!?])/g, (match, mark: string, offset: number, full: string) => {
			const before = full[offset - 1] ?? ""

			if (mark === ":" && before >= "0" && before <= "9") {
				return match
			}

			return ` ${mark}`
		})
		.replace(/\s+([.,)\]])/g, "$1")
		.replace(/([([{]) +/g, "$1")
		.replace(/« */g, "« ")
		.replace(/ *»/g, " »")
		.replace(SPACES, " ")
		.trim()

/**
 * Normalize one text before parsing.
 *
 * The function canonicalizes the punctuation and removes the characters outside
 * the French Latin set. It appends a period when the cleaned text has no
 * terminal mark. An empty or blank text returns an empty string.
 */
export const normalizePunct = (text: string): string => {
	const normalized = normalizeSpacing(
		normalizeQuotes(text.normalize("NFC").replace(ELLIPSIS, "…").replace(DASHES, "-")),
	)
	const cleaned = normalized.replace(NON_LATIN, " ").replace(SPACES, " ").trim()

	if (cleaned === "") {
		return ""
	}

	const last = cleaned.at(-1) ?? ""

	return TERMINAL_MARKS.has(last) ? cleaned : `${cleaned}.`
}
