# AGENTS rules for src/lib/syntax/

These rules take precedence over the rules of the parent directories.

- Keep the parser engine behind an injectable interface. Unit tests inject a
  fake engine and never load the model.
- Read the full CoNLL-U output. The npm wrapper drops the `FEATS` column, and
  the detailed mode needs it. Keep the column names in the code: `FORM`,
  `LEMMA`, `UPOS`, `FEATS`, `HEAD`, `DEPREL`.
- Validate every parse before returning it: `FORM`, `UPOS`, and `DEPREL` are
  present, every `HEAD` is inside the sentence, every sentence has a root, and
  no `HEAD` chain forms a cycle.
- Load the model once. Do not initialise it per query.
- Keep the encoder free of vocabulary, lemmas, and parser hidden states.
- The model file is not committed. `scripts/init.sh` downloads it. Use
  `UDPIPE_MODEL_PATH` to point at it.
- Run `bunx biome check --write <files>` on edited files.
