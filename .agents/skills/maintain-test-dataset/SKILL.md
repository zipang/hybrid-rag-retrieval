---
name: maintain-test-dataset
description: Keep src/lib/syntax/test-data/french-dataset.jsonc complete and well formed. Use when a syntax comparison is added or changed, when dataset.test.ts fails on a missing reference or a broken judgment, or before running the syntax tests. The skill tells you to write the expected Universal Dependencies tree for every new sentence before the tests run.
---

# Maintain the French comparison data set

## Purpose

The file `src/lib/syntax/test-data/french-dataset.jsonc` holds the readable,
growing test set for the French syntax encoder. Each comparison names one
**query**, the sentences that share its grammatical shape (**equal**), and the
sentences that do not (**different**).

The comparison judges the encoder with a frozen expected tree for every
sentence. A sentence without a stored tree cannot be judged. The integrity test
`src/lib/syntax/dataset.test.ts` fails on a missing reference. It also fails
when an `equal` sentence does not score the identical structure, or when a
`different` sentence does.

Use this skill to add the tree of every new sentence **before** the tests run,
and to repair the data when a test reports a missing or wrong reference.

## Data model

The file is JSON with comments (`.jsonc`). Bun parses it with `Bun.JSONC.parse`,
so you can and must explain each section with a `//` comment.

```jsonc
{
  "tests": [
    {
      "query": "Le petit chat est mort",
      "equal": ["La petite souris est vivante"],
      "different": ["Le gentil chat mord"]
    }
  ],
  "references": {
    "Le petit chat est mort": {
      "sentences": [
        [["Le", "le", "DET", 3, "det", "Definite=Def|Gender=Masc|Number=Sing"]]
      ]
    }
  }
}
```

- A **comparison** is one entry under `tests`. `equal` and `different` hold the
  sentence strings, not identifiers.
- **references** is a map. The key is the sentence string itself. The value is
  `{ "sentences": [...] }`, the same shape as one `texts` entry of
  `french.jsonc`.
- One sentence is one **tree**: a list of tokens inside `sentences`. A text with
  two sentences holds two lists, in reading order.
- Each **token** is a list of six values, in this fixed order:

| Position | Field | Meaning |
| --- | --- | --- |
| 0 | `FORM` | The word as it appears in the text. |
| 1 | `LEMMA` | The dictionary form, for example `manger` for `mangé`. |
| 2 | `UPOS` | The universal word class, for example `NOUN`, `VERB`, `ADJ`. |
| 3 | `HEAD` | The 1-based index of the governor. `0` marks the root. |
| 4 | `DEPREL` | The link name, for example `nsubj`, `obj`, `amod`, `det`. |
| 5 | `FEATS` | The grammar features, joined by `|`. The coarse mode ignores them, but write them for the detailed mode. |

## Tree rules

The integrity test rejects a tree that breaks a rule. Follow these rules:

1. Every token has exactly six values.
2. Every sentence has at least one root: one token with `HEAD` equal to `0`.
3. Every `HEAD` points inside the sentence: from `0` to the token count.
4. Every token reaches a root without a loop.
5. No content word depends on a punctuation token. Point the punctuation token
   at the word it belongs to, with `DEPREL` equal to `punct`.

The exact `FORM`, `LEMMA`, and `FEATS` do not change a coarse score. The
structure does: `UPOS`, the base `DEPREL` before any colon, the `HEAD` topology,
and the punctuation marks.

## Workflow

Do these steps in order.

### 1. Read the current data

Read `src/lib/syntax/test-data/french-dataset.jsonc`. Note the sentence strings
already under `references`.

### 2. Find the new sentences

For every sentence in a new or changed `tests` entry, collect the `query`, the
`equal` sentences, and the `different` sentences. A sentence that already has a
reference entry needs no new tree.

### 3. Write one tree per new sentence

For each new sentence:

1. Split it into tokens, in reading order. Keep the punctuation as its own
   token.
2. Choose the `UPOS` of each token.
3. Choose the `HEAD` of each token: the 1-based index of its governor, or `0`
   for the root. The root of a French clause is usually the main verb, or the
   predicate adjective of a copular clause.
4. Choose the `DEPREL` of each link. Use the base name, for example `nsubj`,
   not `nsubj:pass`, when the distinction is not needed. The coarse mode drops
   the part after the colon.
5. Write the `LEMMA` and the `FEATS`. Copy the feature names from an existing
   entry of the same word class to stay consistent.
6. Add the entry to `references`, keyed by the exact sentence string.

Use the parser only as a reference. The data is the reviewed truth, not the
current parser output. If you need a proposal, you can ask the parser with:

```sh
bun run show-syntax-tree "<sentence>"
```

Then review the proposal and correct it. Do not copy a broken parse.

### 4. Check the judgments

An `equal` sentence must score the identical structure. A `different` sentence
must score below it. If you are unsure that your tree gives the intended
judgment, run one comparison without loading the model, with a small script that
encodes the stored trees. The test file `dataset.test.ts` does the same work.

### 5. Run the tests

Run the two data tests and fix every failure:

```sh
bun test src/lib/syntax/dataset.test.ts
bun test src/lib/syntax/test-data.test.ts
```

A failure message names the sentence and the role. Read it, correct the tree or
the comparison, and run the tests again.

### 6. Format the data

Run the formatter on the edited file:

```sh
bunx biome check --write src/lib/syntax/test-data/french-dataset.jsonc
```

## Worked example

Add the comparison:

```jsonc
{
  "query": "Le petit chat est mort",
  "equal": ["La petite souris est vivante"],
  "different": ["Le gentil chat mord"]
}
```

**Query tree** `Le petit chat est mort`. The predicate adjective `mort` is the
root. `est` is a copula. `chat` is the subject.

```jsonc
"Le petit chat est mort": {
  "sentences": [[
    ["Le",   "le",    "DET",  3, "det",   "Definite=Def|Gender=Masc|Number=Sing"],
    ["petit","petit", "ADJ",  3, "amod",  "Gender=Masc|Number=Sing"],
    ["chat", "chat",  "NOUN", 5, "nsubj", "Gender=Masc|Number=Sing"],
    ["est",  "être",  "AUX",  5, "cop",   "Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin"],
    ["mort", "mort",  "ADJ",  0, "root",  "Gender=Masc|Number=Sing"]
  ]]
}
```

The equal sentence `La petite souris est vivante` has the same shape: `DET ADJ
NOUN AUX ADJ`, with the last adjective as the root. It scores `1`.

The different sentence `Le gentil chat mord` is `DET ADJ NOUN VERB`, with the
verb as the root. It scores below `1`.

## Glossary

- **Coarse mode**: the syntax mode that keeps the structure only and drops every
  grammar feature. It is the only mode implemented today.
- **Comparison**: one entry under `tests`. It holds a query, an `equal` set, and
  a `different` set.
- **DEPREL**: the link name between a word and its governor, for example `nsubj`.
- **Equal**: a sentence that must share the grammatical shape of the query.
- **FEATS**: the grammar features of a token, for example gender or tense.
- **Different**: a sentence that must not share the grammatical shape of the
  query.
- **FORM**: the word as it appears in the text.
- **HEAD**: the 1-based index of the word a token depends on. `0` marks the root.
- **LEMMA**: the dictionary form of a word.
- **Query**: the reference sentence of one comparison.
- **Reference**: the stored expected tree of one sentence, under `references`.
- **Token**: one word with its grammar information.
- **Tree**: the tokens of one sentence, each linked to its governor.
- **UPOS**: the universal word class, for example `NOUN` or `VERB`.
