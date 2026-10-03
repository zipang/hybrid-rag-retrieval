# Spec: [T0004] French Syntax Index and Weighted Threshold Retrieval

Ticket: `T0004`  
Status: Approved by the user. Implementation planning follows this specification.

## Scope note

This ticket first delivers a working end-to-end system with the `coarse`
mode. The project defers the `detailed` mode to a future ticket. The
`coarse` mode keeps the grammatical structure only. The `detailed` mode
also keeps an allowlist of grammatical features, such as `Definite`, `Gender`,
and `Tense`.

The code keeps a mode seam, so the future ticket adds the `detailed` branch
without an interface change. The plan records the deferred items in its
"Deferred Work" section. The `coarse` mode is enough to prove the full
pipeline: parse, abstract, encode, store, and query.

## Objective

Add a syntax vector to indexed Qdrant records. Let developers combine syntax, semantic, and keyword scores through a weighted retrieval API.

The syntax score must use grammatical structure alone. Vocabulary and semantic embeddings must not enter the syntax encoder or syntax score.
Other selected indexes contribute through explicit weights. Developers can select syntax alone or combine all available indexes.

For example, these sentences share a coarse grammatical pattern:

- `Le garçon regarde le soleil`
- `Un chat mange une souris`

Both have a verb, a nominal subject, a direct object, and determiners attached to the nouns.
Their coarse representations must match despite their different words and meanings.
Their detailed representations can differ because their determiners have different definiteness.

This feature uses natural-language dependency trees, rather than source-code abstract syntax trees.
The proposed code-representation workflow becomes: parse French grammar, abstract the tree, encode structural features, store vectors, and query Qdrant.

## Confirmed Intent

- Support French in this ticket.
- Offer two grammatical specificity modes: `coarse` and `detailed`. This ticket implements and validates `coarse` first. It defers `detailed` to a future ticket, keeping the mode seam in the code.
- Select one mode per indexing run. Changing the mode requires syntax reindexing.
- Replace retrieval modes with weighted index selection through the API.
- Give each selected index a documented score between zero and one.
- Replace `topK` with a minimum combined matching score, `minScore`.
- Return every qualifying record through pagination, without a hidden candidate cutoff.
- Normalize BM25 with a fixed, validated, versioned transformation.
- Start with a deterministic structural-vector baseline.
- Investigate TypeScript and JavaScript parser implementations first.
- Permit a local Python parser when suitable JavaScript options cannot meet the requirements.
- Defer new chat controls, multilingual validation, and learned encoder training.
- Update existing retrieval callers for compatibility with the new contract.

## Tech Stack and Research Status

- Application orchestration: existing Bun and TypeScript application.
- Database: Qdrant 1.19.1, as documented in the project mirror.
- Transport: existing thin HTTP client in `src/lib/qdrant.ts`.
- Tests: `bun:test` with colocated test files.
- Formatting and linting: existing Biome configuration.
- Encoder: deterministic, fixed-length structural feature vector with cosine similarity.
- Retrieval: bounded per-index scores, weighted combination, inclusive threshold, and complete paginated results.
- Parser and model: selection gate before implementation. No new dependency is selected by this specification.

### Parser feasibility findings

Official documentation review identified these candidates. No runtime feasibility or accuracy experiment has run yet.

| Candidate | Finding | Required follow-up |
| --- | --- | --- |
| NLP.js | Its documented features do not establish French dependency-tree output. | Do not select it based on French tokenization support alone. |
| Transformers.js | Its supported tasks do not include a ready dependency-parsing pipeline. | Require an actual French model, head decoding, and grammatical output before selection. |
| Third-party `udpipe-wasm` | Its documented JavaScript interface exposes dependency heads, labels, and word classes. It does not expose morphology. | Test Bun compatibility, French models, and access to grammatical features for detailed mode. |
| Native UDPipe | Its documented output includes dependency heads, labels, word classes, and grammatical features. | Compare a locally invoked executable with other candidates. Check the selected model license. |
| Local Stanza | Its official dependency-parser example uses French. Its word objects expose the required grammatical annotations. | Evaluate a local Python component if JavaScript candidates fail the selection gate. |

The selection gate must compare output completeness, test data set quality for French, runtime compatibility, model licensing, memory, and warm-query latency.
Prefer JavaScript or TypeScript when it meets those requirements without substantial custom parser development.
Allow native UDPipe or local Stanza when the JavaScript options do not qualify.

Before adoption, pin the selected parser and model versions.
Use the librarian workflow to mirror their official documentation and release references under `docs/<tool> - <version>/`.
Read that mirror before implementation. Update the root documentation registry according to project rules.

## Functional Requirements

### 1. Parse and abstract the grammatical tree

The parser must produce token positions, dependency heads, dependency labels, word classes, and available grammatical features.
Validate tree connectivity, head references, roots, and cycles before encoding.

The encoder receives only abstract grammatical data. Remove token text, content-word lemmas, lexical identifiers, and parser hidden states from its input.
The parser can use words to infer grammar. Vocabulary independence applies after parsing, not to the parser itself.
One exception is a punctuation mark: the abstraction reads the punctuation lemma into a dedicated field, because a mark is a closed grammatical symbol, not vocabulary.

Modes have these proposed definitions:

| Detail | `coarse` | `detailed` |
| --- | --- | --- |
| Dependency connections | Retain | Retain |
| Universal word classes | Retain, with `PROPN` mapped to `NOUN` | Retain |
| Relative word order | Retain | Retain |
| Dependency labels | Retain base labels | Retain full labels, including subtypes |
| Grammatical features | Remove | Retain an explicit allowlist |
| Vocabulary and lemmas | Remove, except the punctuation mark | Remove, except the punctuation mark |
| Punctuation nodes | Retain, in position and with their mark | Retain, in position and with their mark |

The proposed detailed allowlist is `Definite`, `Gender`, `Mood`, `Number`, `Person`, `Tense`, `VerbForm`, and `Voice`.
Record missing features consistently. Do not infer missing features from lexical identity.
Canonicalize annotation order so equivalent annotations generate identical representations.

### Punctuation marks

Punctuation carries grammatical information, so both modes keep it. A
punctuation node stays in its position in the tree and keeps the governor that
the parser assigned.

The abstraction reads the token's `LEMMA` field, which holds the mark itself
(`?`, `!`, `.`, `,`), and stores it in a `punctuationMark` field on the node.
The token's `FORM` and `LEMMA` are still dropped for every other token, so a
content word never leaks its vocabulary. A mark is a closed symbol set, not
open vocabulary.

The encoder gives the mark an explicit weight, so `Il vient` and `Il vient ?`
no longer share one vector. The parser attaches punctuation to the head of the
clause or phrase it belongs to, following the UD `punct` rules, so the
attachment is kept without normalization.
See `memos/syntax-trees.md`, section 8, and Tasks 11a and 11b of the plan.

### Word-class normalization

A word class can carry a lexical difference that has no place in a structural
comparison. The class `PROPN` (proper noun) and the class `NOUN` (common noun)
are both nominal. Whether a word is a "named thing" or a "common thing" is a
property of the word, not of the structure.

The `coarse` mode maps `PROPN` onto `NOUN`, so a proper noun and a common
noun compare as one nominal class. The `detailed` mode keeps the raw class.
This rule was added after the parser evaluation showed the same interjection
tagged as `NOUN` in one sentence and `PROPN` in another.

Support sentence fragments that produce valid trees, because slogans often omit complete clauses.
For multiple sentences, preserve sentence boundaries in a grammatical forest and encode the complete content field.
Treat punctuation marks as significant: two texts that differ only in a mark are not equivalent (see "Punctuation marks"). Ignore whitespace differences alone.
Report malformed or empty parses explicitly. Do not substitute semantic embeddings or word-class sequences.

### 2. Encode structure into a fixed-length vector

Use a deterministic feature map derived from the abstract tree.
Include connected features such as labeled edges, rooted paths, and bounded subtrees.
A word-class histogram or word-class sequence alone does not meet this requirement.

Identical canonical trees must produce identical finite, nonzero vectors under the same configuration.
Normalize vectors consistently for cosine comparison.
Measure false matches from feature hashing or other dimensionality reduction.
Vector similarity approximates tree resemblance. It does not prove that two trees are identical.

The plan must choose feature families, weights, dimensionality, and any hash seed from test data set evaluation.
Freeze these choices in a versioned encoder configuration before corpus indexing.
Do not train a Tree-LSTM or graph neural network in this ticket.

### 3. Store and rebuild syntax vectors

Add one named dense vector, `syntax`, to the same collection and point identifiers as existing records.
Use Qdrant cosine distance and its native vector indexing.
Store the syntax vector as a multivector with the `max_sim` comparator.
Each row of the matrix is one sentence of the text.
`max_sim` scores a query row against the best matching row of the record.
This shape matches the grammatical forest and keeps one point per record.

Qdrant's local documentation supports adding a vector definition without recreating the collection:
`PUT /collections/{collection_name}/vectors/{vector_name}`.
Populate existing points through vector updates. Adding a definition alone does not populate points.

Provide a syntax-only backfill path over the indexed records.
It must preserve existing semantic vectors, BM25 vectors, record identifiers, and business payload fields.
Also populate syntax vectors during subsequent full indexing runs when syntax indexing is enabled.
The current full indexer deletes its collection. The syntax-only path must not reuse that deletion behavior.

Persist the mode, language, parser version, model revision, abstraction version, and encoder configuration identifier.
Persist dimensions and feature configuration as part of the reproducible index configuration.
Queries must use that persisted configuration and reject incompatible runtime configuration.

Prevent queries from mixing vectors from different configurations during a rebuild.
Publish a ready state only after the run accounts for every record.
Report totals for eligible, indexed, unsupported, and failed records.
Give every excluded record an identifier and reason. Never claim full coverage after silent exclusions.
Parser failures must not create zero vectors or leave stale syntax vectors searchable.

### 4. Define bounded index scores

Expose the index names `syntax`, `semantic`, and `keyword`.
Each selected index contributes a finite score in `[0, 1]` for each eligible record.
These scores express index-specific matching strength. They are not probabilities or cross-index calibrated confidence values.

Use a fixed, documented transformation of cosine scores for syntax and semantic indexes.
The proposed transformation is `max(0, min(1, cosine))`. It maps negative cosine values to zero and preserves positive cosine values.

For keyword scores, select a fixed monotonic BM25 transformation through evaluation.
An initial candidate is `rawScore / (rawScore + scale)`, with a positive, versioned `scale` parameter.
Validate its threshold behavior before adoption. Record the final formula and parameters in the scoring configuration.
A record with no keyword overlap receives zero, even when sparse search omits it from its result stream.

Do not normalize by response maxima, page contents, or candidate-batch statistics.
BM25 scores can change when corpus statistics change. Bind scoring and pagination to an index generation.
Do not use reciprocal-rank fusion as the public matching score.

### 5. Combine indexes and apply the matching threshold

Replace `mode=syntax` and `topK` with explicit index weights and `minScore`.
Keep `GET /api/slogans`, `q`, `yearFrom`, and `yearTo`.

Proposed query parameters:

- `weights`: a JSON object whose keys are index names and whose values are fractional contribution weights.
- `minScore`: a required finite number in `[0, 1]`.
- `pageSize`: a positive integer that controls delivery size, not match eligibility.
- `cursor`: an opaque continuation token for subsequent pages.

Require at least one positive weight. Require nonnegative finite weights with a sum of one, within a documented numerical tolerance.
An omitted index or an index with zero weight makes no contribution and triggers no query embedding or parsing for that index.
Reject unknown index names, invalid weights, missing thresholds, and obsolete `topK` or `mode` parameters with HTTP 400.
Do not silently normalize invalid weights or supply hidden defaults for matching strength.

For every eligible record, compute:

```text
combinedScore = sum(weight[index] * normalizedScore[index])
match = combinedScore >= minScore
```

Apply payload filters before qualification. Return records in descending combined score order, with a stable point-identifier tie-breaker.
Return the combined score as `score` and selected per-index scores as `scores`.
Include the weights, threshold, normalization version, index generation, and applicable syntax configuration in response metadata.
Return `nextCursor` when more qualifying records remain. Preserve an empty `results` list when no record qualifies.

### 6. Guarantee complete paginated results

Every eligible record at or above the threshold must appear exactly once when the caller follows all continuation cursors.
At `minScore=0`, zero-score records also qualify.
An ordinary bounded top-K union cannot guarantee this contract.
Records with moderate scores across multiple indexes can qualify without appearing in any small individual top-K list.

Use an exact scoring path or a candidate-enumeration algorithm with a proven completeness bound.
Use documented Qdrant exact search and vector operations where they meet the contract.
The plan must demonstrate exhaustive handling of sparse nonmatches, tied scores, combined scores, and zero thresholds.
Internal batch limits must not become result-eligibility limits.

Keep page scores stable for one query and index generation.
Bind cursors to the query, filters, weights, threshold, scoring configuration, and index generation.
Reject expired or incompatible cursors explicitly. Never silently continue against a changed corpus generation.
Document the cursor lifetime and page-size bounds in the plan.

When syntax has a positive weight, return HTTP 503 if its index is absent, rebuilding, or incompatible.
Do not renormalize weights when a selected index or record vector is unavailable.
For combined syntax retrieval, explicitly exclude records marked unsupported by syntax indexing and report that eligibility scope.
Treat unexpected missing vectors as an index-integrity failure rather than a zero match.
Requests that do not select syntax must work without a syntax parser or ready syntax index.
Return HTTP 400 for blank input or unusable grammatical input when syntax is selected.
Return HTTP 503 for selected parser unavailability.

### 7. Migrate existing retrieval callers

Replace the current RRF and `topK` retrieval contract in API handlers, retrieval services, smoke scripts, and internal callers.
Give each caller explicit weights and a documented minimum score.
Preserve existing record fields and filters while updating the score meaning.
Update chat tool contracts and result handling as needed for compatibility.
New chat controls for weights or syntax are outside this ticket.
Document this API-breaking change and the migration from `topK` to `minScore` and `pageSize`.

## Commands

Existing executable project commands:

```sh
bun test
bun run lint
bun run dev
bun run smoke
```

`bun run index` performs a destructive full rebuild today. It is not a syntax-only backfill command.

Proposed commands to implement and document in this ticket:

```sh
bun run scripts/index-syntax.ts --mode coarse
bun run scripts/index-syntax.ts --mode detailed
bun run scripts/evaluate-syntax.ts --mode coarse
bun run scripts/evaluate-syntax.ts --mode detailed
curl --get 'http://localhost:3000/api/slogans' \
  --data-urlencode 'q=Le garçon regarde le soleil' \
  --data-urlencode 'weights={"syntax":1}' \
  --data-urlencode 'minScore=0.8' \
  --data-urlencode 'pageSize=50'
curl --get 'http://localhost:3000/api/slogans' \
  --data-urlencode 'q=Le garçon regarde le soleil' \
  --data-urlencode 'weights={"syntax":0.5,"semantic":0.3,"keyword":0.2}' \
  --data-urlencode 'minScore=0.7' \
  --data-urlencode 'pageSize=50'
```

The plan must define the parser setup command after parser selection.
Format edited source files with `bunx biome check --write` followed by their explicit paths.

## Project Structure

Current integration points:

```text
src/lib/qdrant.ts             Qdrant collection, vectors, and queries
src/lib/retrieval.ts          Weighted scoring, threshold matching, and record mapping
src/server/api.ts            GET /api/slogans input and response handling
src/server/index.ts          Runtime dependency initialization
scripts/index-slogans.ts     Full dataset indexing
src/server/chat.ts           Existing retrieval caller and tool contract
src/components/app/RetrievalPanel.tsx  Existing API caller
scripts/smoke-retrieval.ts   Existing retrieval smoke checks
```

Proposed additions:

```text
src/lib/syntax/              Parser adapter, abstraction, encoder, and configuration
scripts/index-syntax.ts      Syntax-only backfill and mode rebuild
scripts/evaluate-syntax.ts   Reproducible French comparison bench
roadmap/T0004/spec.md        Requirements and review decisions
roadmap/T0004/plan.md        Implementation plan after specification approval
```

Place tests beside the modules they verify. Store small, reviewed grammatical test data beside syntax tests.
The plan determines final module names and test data paths.

## Code Style

Use strict TypeScript types, arrow functions, and JSDoc for every function.
Use tabs in source files and two-space indentation in Markdown.
Keep a blank line before control statements and return statements.
Inject parser and database dependencies so encoder tests require neither service.

Illustrative configuration style:

```ts
type SyntaxMode = "coarse" | "detailed"

/** Return whether two syntax configurations use the same specificity. */
const hasSameMode = (indexed: SyntaxMode, requested: SyntaxMode): boolean => {

	return indexed === requested
}
```

## Testing Strategy

Separate parser errors from encoder errors.
Use manually reviewed grammatical trees for encoder tests and actual French sentences for parser integration tests.

- Test identical abstract trees with different vocabulary and lexical metadata.
- Test different connections with the same word classes and node counts.
- Test coarse invariance to morphological changes.
- Test detailed sensitivity to each available allowlisted feature.
- Test whitespace, punctuation, contractions, fragments, and sentence boundaries.
- Test malformed trees, missing features, empty input, and parser failures.
- Test query configuration mismatch and rebuild readiness.
- Test syntax-only retrieval without semantic embedding or fusion calls.
- Test each index alone and weighted combinations against known component scores.
- Test exact threshold equality, thresholds zero and one, invalid weights, and empty results.
- Test fixed normalization across pages and candidate batches.
- Test records that qualify only through moderate contributions from multiple indexes.
- Test complete pagination against an exhaustive reference scorer, including ties and keyword nonmatches.
- Test cursor binding, expiration, index generation changes, and selected-index failures.
- Test callers after removal of `topK` and RRF score assumptions.
- Test backfill preservation of other vectors and record payloads.
- Run Qdrant integration checks against an isolated test collection.

Build a reviewed French evaluation set with at least 30 query/positive/negative triplets.
Include different-word positives, shared-word negatives, and same-word-class cases with different dependency connections.
Evaluate both modes through separate indexing runs on the same test data set.
Freeze test data set judgments before feature-weight tuning. Report parser failures separately from ranking failures.

Record parser startup time, warm parsing latency, encoding latency, Qdrant latency, indexing throughput, memory, and syntax coverage.
Also measure complete weighted-query latency, pagination cost, and result-state storage against corpus size.
No hardware-independent latency target is approved yet. The selection gate must report measurements and propose a target for review.

## Success Criteria

The following numerical targets are proposed for specification review:

1. Identical canonical trees yield identical vectors and cosine similarity of at least `0.999999` in encoder tests.
2. The two supplied French sentences produce the same coarse tree and a syntax cosine score of at least `0.99`.
3. The detailed mode represents determiner definiteness differences and scores those examples below their exact detailed self-match.
4. Every reviewed connection-change test case receives a lower score than its identical-tree counterpart.
5. At least 90% of the reviewed French triplets rank the structural positive above the negative in each mode.
6. Qdrant exact search reproduces local cosine ordering within floating-point tolerance. Treat equal-score ties as unordered.
7. All indexed records have either a compatible syntax vector or an explicit exclusion reason in the indexing report.
8. Reindexing specificity never exposes mixed-mode vectors to syntax queries.
9. Syntax-only requests honor filters and do not call semantic embedding or hybrid fusion.
10. Each supported index can operate alone or contribute to a weighted combined score.
11. Syntax-only backfill preserves existing vector data and business payload fields.
12. Both mode evaluations produce reproducible configuration and measurement reports.
13. Returned combined scores equal the weighted sum of component scores within a documented floating-point tolerance.
14. Every record meeting the inclusive threshold appears exactly once across all pages of a fixed query generation.
15. No record below the threshold appears. A valid query without qualifying records returns an empty list.
16. Page size, tied scores, and candidate-batch size do not change qualification or component scores.
17. An exhaustive reference test covers moderate-score combinations and `minScore=0` sparse nonmatches.
18. Existing callers use the revised contract, and record fields and payload filters retain their behavior.

## Boundaries

### Always

- Use grammatical structure as the syntax encoder input.
- Use the same parser, abstraction, and encoder configuration for indexing and queries.
- Validate configuration and tree structure.
- Account for every record during backfill.
- Guarantee complete threshold results and stable pagination for the query generation.
- Expose component scores and their normalization configuration.
- Verify official documentation before adopting a parser or database operation.
- Run meaningful tests and the matching formatting checks.

### Ask first

- Change the approved mode definitions or numerical acceptance targets.
- Adopt a runtime dependency or model after the feasibility review.
- Add learned encoder training, remote parsing, or multilingual support.
- Recreate or delete a collection as part of syntax migration.
- Add new chat controls or cross-index probability calibration.

### Never

- Include vocabulary, lemmas, semantic vectors, or parser hidden states in the syntax encoder.
- Silently fall back to keyword or semantic search.
- Search a mixed-configuration syntax index.
- Read secrets files or commit secrets.
- Delete existing records to perform syntax-only backfill.
- Substitute a hidden top-K cutoff for complete threshold matching.
- Normalize matching scores from response maxima or batch statistics.

## Decisions Pending Before Implementation

- Select and pin a parser and French model after the JavaScript-first feasibility gate.
- Confirm the proposed mode details, morphology allowlist, and numerical acceptance targets during specification review.
- Choose tree-feature families, dimensionality, weights, and hashing policy through evaluation.
- Choose configuration storage, readiness tracking, and rebuild publication mechanics.
- Validate and freeze cosine and BM25 normalization formulas and parameters.
- Select an exact weighted-scoring strategy with complete candidate accounting.
- Define cursor lifetime, storage, page-size bounds, and caller migration settings.
- Establish measured latency targets for complete threshold retrieval.

These decisions do not authorize application implementation before specification and plan approval.

## References

- [Local Qdrant documentation index](../../docs/Qdrant%20-%201.19.1/index.md)
- [Local Qdrant vector schema operations](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/collections/index.md#update-vector-schema)
- [Local Qdrant exact search and pagination](../../docs/Qdrant%20-%201.19.1/documentation/search/search/index.md)
- [Local Qdrant fusion limitations](../../docs/Qdrant%20-%201.19.1/documentation/search/hybrid-queries/index.md)
- [NLP.js official features](https://github.com/axa-group/nlp.js)
- [Transformers.js supported tasks](https://huggingface.co/docs/transformers.js/en/index)
- [Third-party UDPipe/WASM interface](https://github.com/exp-ouroborous/udpipe-wasm)
- [UDPipe official manual](https://ufal.mff.cuni.cz/udpipe/1/users-manual)
- [UDPipe models](https://ufal.mff.cuni.cz/udpipe/1/models)
- [Stanza French dependency parsing](https://stanfordnlp.github.io/stanza/depparse.html)
- [Stanza grammatical features](https://stanfordnlp.github.io/stanza/pos.html)

Parser sources are feasibility references. A versioned local mirror is required before parser adoption.

## Glossary

- **Abstraction:** Removal of words and selected grammatical details from a parse while retaining its structural connections.
- **Backfill:** Addition of syntax vectors to records that already exist in the database.
- **Canonical tree:** A grammatical tree written in a consistent form, without vocabulary or irrelevant annotation ordering.
- **Cosine similarity:** A comparison of vector directions. Identical nonzero vectors have a score of one.
- **Cursor:** An opaque token that continues a paginated query with the same scoring and index generation.
- **Dependency tree:** A grammatical representation that connects each word to its governing word and labels that relationship.
- **Encoder:** A component that converts an abstract grammatical tree into a fixed-length list of numbers.
- **Feature hashing:** A method that maps many structural features into a fixed number of vector positions. Different features can share positions.
- **Grammatical forest:** A representation containing one grammatical tree for each sentence in a record.
- **Index generation:** A version of corpus data and scoring configuration used consistently for one paginated query.
- **Morphology:** Grammatical details such as tense, number, gender, and definiteness.
- **Named vector:** A vector field with its own name and configuration in a Qdrant collection.
- **Normalization:** A fixed transformation that converts an index score into the documented range from zero to one.
- **Pagination:** Delivery of all matching records through multiple bounded responses.
- **Parser:** A component that identifies words, grammatical features, and grammatical relationships in a sentence.
- **Specificity mode:** The indexing configuration that selects which grammatical details the syntax representation retains.
- **Syntax search:** Retrieval by grammatical-tree resemblance. It differs from the existing keyword search called syntactic proximity in the root README.
- **Threshold:** The minimum combined score that a record must meet to qualify for retrieval.
- **Triplet:** A query, a structurally similar positive example, and a structurally different negative example used to evaluate ranking.
- **Word class:** A grammatical category such as noun, verb, or determiner.
- **Weighted retrieval:** Retrieval that combines normalized index scores using explicit contribution weights.
