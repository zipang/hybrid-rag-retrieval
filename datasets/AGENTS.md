# AGENTS rules for datasets/

These rules take precedence over the rules of the parent directories.

- Never commit a corpus file. `.gitignore` excludes every file in this
  directory, except the `README.md` and `AGENTS.md`.
- Keep the text format in `README.md` stable. Schema property keys are canonical
  field labels. Property titles provide fallback labels for existing files.
- Keep record structures and titles in `src/models/`. Keep dataset paths,
  content fields, and identifiers in `src/config/datasets.ts`.
- Give every record schema and property a non-empty description. Start each
  property description with `Content field`, `Filter field`, or
  `Record identifier`.
- Set each property's `title` to the legacy source label when it differs from
  the key. The reader checks keys before titles.
- Keep schema properties in customary corpus order for readability. Do not rely
  on that order for parsing.
- Keep the role descriptions in the schemas and the field-usage table in
  `README.md` aligned.
- Use UTF-8. Keep the accents and the punctuation of the source text.
- Do not rename a schema key or title without updating its corpus and tests.
