# Parser decision: French dependency parser for T0004

Ticket: `T0004` — related spec: `spec.md`, related plan: `plan.md`

Status: decided. The project selects `udpipe-wasm` `0.1.0` with the
`french-gsd` UD 2.5 model.

## Objective

Task 3 selects the French dependency parser. The parser must produce token
positions, dependency heads, dependency labels, word classes, and grammatical
features. It must run from the Bun and TypeScript application.

## Selection gate

The parser must pass these checks:

1. Output completeness: head, label, word class, and morphological features.
2. French quality on the reviewed test data set.
3. Runtime compatibility with Bun.
4. Model license.
5. Memory and warm-query latency.

## Decision

The project selects the JavaScript and WebAssembly candidate:

- Package: `udpipe-wasm` version `0.1.0`.
- Parser engine: UDPipe version `1.3.1`.
- Model: `french-gsd-ud-2.5-191206`.
- Package license: MPL-2.0. UDPipe license: MPL-2.0.
- Model license: CC BY-SA 4.0. The non-commercial restriction no longer
  applies.

The reason is speed and a single runtime. The project scores every record in
the retrieval path. The JavaScript candidate runs inside Bun and needs no
Python process.

## Candidates and measurements

Measured on the reviewed test data set. The `french-gsd` row and the native
UDPipe row share one model, so their accuracy is the same.

| Candidate | UPOS | Head | Label | Peak memory | Warm time |
| --- | --- | --- | --- | --- | --- |
| `udpipe-wasm` 0.1.0, UDPipe 1.3.1 | 95.1% | 81.8% | 80.8% | in-process | 5 to 13 ms |
| Native UDPipe 1.3.1 | same | same | same | 69 MB | about 3.7 ms |
| Stanza 1.15.0 | 96.8% | 91.0% | 87.5% | 1237 MB | about 82 ms |

Stanza is more accurate. It needs about 1.2 GB of memory and a Python process.
The project rejected it on speed, memory, and runtime simplicity.

## Output completeness

The package `Parser.parse` returns `form`, `lemma`, `upos`, `head`, and
`deprel`. It does not expose the morphological features. The `detailed` profile
needs the features.

The underlying wasm `parseToConllu` produces the full CoNLL-U record, including
the `FEATS` column. The npm wrapper discards `FEATS`. The adapter must read the
raw CoNLL-U output. That is a small adapter, not a new parser.

The parser handles multiple sentences. It emits one CoNLL-U block per sentence
and resets the token id to 1 for each sentence.

## Model alternatives

The project compared the four French models that UDPipe ships:

| Model | Source treebank | Treebank license | UPOS | Head | Head and label |
| --- | --- | --- | --- | --- | --- |
| `french-gsd` | UD_French-GSD | CC BY-SA 4.0 | 97.8% | 89.0% | 86.3% |
| `french-sequoia` | UD_French-Sequoia | LGPL-LR | 97.8% | 86.8% | 84.1% |
| `french-partut` | UD_French-ParTUT | CC BY-NC-SA 4.0 | 95.6% | 88.0% | 84.3% |
| `french-spoken` | UD_French-Spoken | (spoken) | 95.5% | 76.1% | 69.9% |

The project selected `french-gsd`. It has the best accuracy and a permissive
license.

## License analysis

The UDPipe 2.5 download page labels all four models CC BY-NC-SA. That label is
outdated. The license follows the source treebank, and the treebanks changed:

- UD_French-GSD is CC BY-SA 4.0. Google dropped the non-commercial restriction
  on the annotations on 2019-11-15.
- UD_French-Sequoia is LGPL-LR.
- UD_French-PUD is CC BY-SA 3.0.
- UD_French-Rhapsodie and UD_French-ParisStories are CC BY-SA 4.0.
- UD_French-ParTUT stays CC BY-NC-SA 4.0.

The selected model has no non-commercial restriction. The share-alike clause
still applies. The project must keep the model license and attribute the
treebank.

One risk stays open. The underlying sentences of UD_French-GSD come from web
text. Google asserts no ownership over them. Legal review is necessary before
commercial use.

## Test data set quality

The parser uses the UD 2.5 label set. The test data set uses the current French
guidelines. The known differences are:

- `acl:relcl` (parser) against `advcl:cleft` (test data set) for clefts.
- `nsubj` (parser) against `expl:subj` (test data set) for impersonal `il`.
- Base labels against subtypes, for example `obl` against `obl:mod`.
- Tokenization differences for elisions and contractions. The parser expands
  some forms differently. The evaluation must align tokenization before it
  compares tokens one by one.

These differences are label and segmentation choices, not parse failures.

## Open items before implementation

- Approve the runtime dependency on `udpipe-wasm` and UDPipe 1.3.1.
- Approve the `french-gsd` model and its license.
- Define the tokenization alignment rule for the evaluation.
- Measure memory and warm latency for a batch of records.
- Mirror the `udpipe-wasm` and UDPipe documentation through the librarian
  workflow before adoption.

## References

- `src/lib/syntax/test-data/french.json`
- `roadmap/T0004/evaluation.md`
- `memos/syntax-trees.md`
- [udpipe-wasm package](https://github.com/exp-ouroborous/udpipe-wasm)
- [UDPipe project](https://github.com/ufal/udpipe)
- [UDPipe model page and accuracy table](https://ufal.mff.cuni.cz/udpipe/1/models)
- [UD_French-GSD treebank and license metadata](https://github.com/UniversalDependencies/UD_French-GSD)
- [Stanza project](https://github.com/stanfordnlp/stanza)

## Glossary

- **CoNLL-U**: the plain-text format that carries Universal Dependencies
  annotation as one line of ten fields per word.
- **FEATS**: the CoNLL-U field that holds the morphological features of a word.
- **Model**: the trained data file that a parser loads. The parser code and the
  model have separate licenses.
- **MPL-2.0**: the Mozilla Public License 2.0. A permissive license with a
  share-alike clause on modified files.
- **Non-commercial (NC)**: a license clause that forbids commercial use.
- **Selection gate**: the required checks that a parser must pass before the
  project adopts it.
- **Share-alike (SA)**: a license clause that requires derived works to keep the
  same license.
- **Stanza**: a Python natural-language toolkit from Stanford University.
- **Tokenization**: the split of a text into tokens. Two parsers can split the
  same text differently.
- **UD**: Universal Dependencies, a cross-language standard for dependency
  annotation.
- **UDPipe**: a trainable pipeline for tokenization, tagging, lemmatization, and
  dependency parsing.
- **Warm latency**: the time to parse, after the model is loaded.
- **WebAssembly (wasm)**: a binary format that runs native code in a sandbox.
