# Syntax

This folder gives a computer a way to see the **grammatical shape** of a French
sentence, independently of the words themselves.

Two sentences can mean different things and still share one shape:

- "Le garçon regarde le soleil" (The boy looks at the sun)
- "Un chat mange une souris" (A cat eats a mouse)

Both are built the same way: a subject noun, a verb, an object noun, and a
determiner in front of each noun. This folder turns that shared shape into
numbers a computer can compare. The words and their meanings stay out of the
encoder. Only the structure goes in.

The syntax format is **Universal Dependencies** (UD). The full field
specification is at <https://universaldependencies.org/format.html>.

## The journey of one text

A **slogan** starts as plain text and becomes a list of numbers that a search
engine can compare. Here is each step, with the real function that does it. A
step marked **(planned)** is not written yet.

```text
  slogan text
      |
      |  createSyntaxParser(env)      builds the parser
      |  parser.parse(text)           reads the text
      v
  CoNLL-U text          (a table: one row per word)
      |
      |  parseConlluBlocks(conllu)    turns rows into tokens
      |  validateParse(parsed)        checks the tree is well formed
      v
  syntax tree           (words linked to their grammar role)
      |
      |  abstraction (planned)        removes words, keeps the shape
      v
  abstract tree         (roles only, no vocabulary)
      |
      |  encoder (planned)           turns the shape into numbers
      v
  vector                (a fixed list of numbers)
      |
      |  Qdrant max_sim              compares vectors
      v
  syntax score          (a number from 0 to 1)
```

### Step 1: build the parser

`createSyntaxParser(env)` (in `config.ts`) builds a Universal Dependencies
parser. It reads the grammar model path from the `UDPIPE_MODEL_PATH`
environment variable. The command `bun run init` downloads the model.

### Step 2: the parser reads the text

`parser.parse(text)` sends the text to the parser. The parser returns a
**CoNLL-U** table: one line per word. Each line has ten columns. This project
uses six of them:

| Column | Name | Meaning |
| --- | --- | --- |
| 2 | `FORM` | The word as it appears in the text. |
| 3 | `LEMMA` | The dictionary form, for example "manger" for "mange". |
| 4 | `UPOS` | The universal word class, for example `NOUN` or `VERB`. |
| 6 | `FEATS` | Small grammar details, for example `Gender=Fem\|Tense=Pres`. |
| 7 | `HEAD` | The 1-based index of the word this word depends on. `0` marks the root. |
| 8 | `DEPREL` | The name of the link to the head, for example `nsubj` or `obj`. |

The other four columns describe the token index, the language-specific tag, the
enhanced dependencies, and other annotations. This project does not use them.

The column numbers and the names follow the UD specification
(<https://universaldependencies.org/format.html>).

This step lives in `parser.ts`. The engine that guesses the grammar is loaded by
`udpipe-engine.ts`.

A text with two sentences gives two tables. The project keeps them apart,
because each sentence is its own tree.

### Step 3: the table becomes a checked tree

`parseConlluBlocks(conllu)` turns the table into tokens. Each token is a short
list in this fixed order: `[FORM, LEMMA, UPOS, HEAD, DEPREL, FEATS]`.

`validateParse(parsed)` then checks the tree is sane:

- every word has a form, a word class, and a link name.
- the "depends on" number points at a real word (or `0` for the root).
- every sentence has at least one root.
- no word depends on itself in a loop.

If a check fails, the parser throws an error instead of returning a broken tree.

### Step 4: the tree becomes an abstract shape **(planned)**

The next module, `abstraction.ts`, will throw away the words and keep only the
shape: which word classes connect to which, and with what link. The word
"garçon" and the word "chat" both become `NOUN`, so the two example sentences
above become the same shape.

### Step 5: the shape becomes a vector **(planned)**

The module `encoder.ts` will turn the abstract shape into a fixed list of
numbers, called a **vector**. The same shape always gives the same vector.

### Step 6: two vectors become a score

Qdrant stores each vector and compares two of them with its `max_sim` function.
The result is a **syntax score** between 0 and 1. A high score means the two
sentences have a similar shape.

## What is in this folder

| File | Plain description |
| --- | --- |
| `parser.ts` | Reads CoNLL-U and checks the tree. |
| `udpipe-engine.ts` | Loads the real grammar model. |
| `config.ts` | Builds the parser from the environment. |
| `normalize-fr.ts` | Canonicalizes French punctuation and strips non-Latin characters before parsing. |
| `test-data/french.json` | 55 French texts with their hand-made trees, used to judge the parser and the encoder. Each text is keyed by its own sentence, so a reader sees what a comparison means. |
| `test-data.test.ts` | Checks the test data set is complete and well formed. |

## The grammar model

The parser uses the `french-gsd` model, a file of about 24 MB that learned
French grammar from human-annotated examples. `bun run init` downloads it into
`models/`. The parser loads it once, then reuses it for every text.

The parser is not yet connected to the running web server. Later work uses it to
index slogans and to answer syntax queries.

## Errors you can get

| Error | What it means |
| --- | --- |
| `ParserUnavailableError` | The grammar model file is missing. Run `bun run init`. |
| `ParseValidationError` | The parser returned a broken tree, such as a loop or a missing root. |
| `EmptyInputError` | The text was blank. |

## Glossary

- **CoNLL-U**: the plain-text table format that Universal Dependencies uses to
  describe one sentence, one line per word.
- **Dependency tree**: a tree where each word points to the word it depends on,
  and each link has a grammatical name such as `nsubj` for a subject.
- **DEPREL**: the CoNLL-U column that names the link between a word and its
  head, for example `nsubj` or `obj`.
- **Encoder**: the part that turns a shape into a list of numbers.
- **FEATS**: the CoNLL-U column that holds small grammar details, such as
  gender or tense.
- **FORM**: the CoNLL-U column that holds the word as it appears in the text.
- **HEAD**: the CoNLL-U column that holds the index of the word a given word
  depends on. A value of `0` marks the sentence root.
- **LEMMA**: the CoNLL-U column that holds the dictionary form of a word, for
  example "manger" for "mange".
- **Model**: a trained data file that the parser loads to guess grammar.
- **Parser**: the part that finds the words and their grammar links.
- **Root**: the main word of a sentence. It depends on nothing.
- **Token**: one word together with its grammar information.
- **UDPipe**: the grammar engine that this project uses.
- **Universal Dependencies (UD)**: a cross-language standard for grammatical
  annotation. It defines the word classes and the link names that this project
  uses. Format specification: <https://universaldependencies.org/format.html>.
- **UPOS**: the CoNLL-U column with the universal word class, for example `NOUN`
  or `VERB`.
- **Vector**: a fixed list of numbers that stands for one shape.
