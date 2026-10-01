# RAG demo — hybrid search on short-text corpora

## Overview

This project is a proof of concept (POC) for a hybrid retrieval workflow. It
indexes a corpus of short text records, then answers questions about them with a
large language model (LLM).

The project is a learning tool and a comparison bench. It shows one complete
workflow: build a corpus, index the corpus in a vector database, and query the
index through a small chat application.

## The problem

Many datasets have the same shape:

- one short text field carries the meaning of a record, for example a citation,
  a popular expression, or an advertising slogan;
- a few other fields describe the record, for example an author, a language, a
  year, or a brand. These fields are not part of the meaning. They narrow a
  search.

A user wants two kinds of search:

- **syntactic proximity** — find the records that contain the exact words of a
  phrase. This search must ignore typos and accents.
- **semantic proximity** — find the records that are close in meaning, even
  with different words.

The user can add one or more filters, for example a year range or an author.
The filters turn on and off one by one.

The project answers both kinds of search in one request. It combines a keyword
index and a vector index. This combination is a **hybrid search**.

## Example datasets and query samples

The workflow works on any short-text corpus. These examples show the range of
the pattern. Each example gives a sample query in full natural language.

1. **Citations** — the content field is the citation text. The filter fields are
   the author, the work title, and the year.
   - Semantic search: "Give me citations about courage."
   - Syntactic search: "Find the citations that contain the words 'to be or not
     to be'."
   - Filter: "Show me the citations from the year 1900 to the year 1950."
   - Combined: "Find citations about hope by Victor Hugo."
2. **Popular expressions** — the content field is the expression. The filter
   fields are the language, the region, and the theme. The corpus can mix
   several languages.
   - Semantic search: "Which expressions mean 'do not count your chickens before
     they hatch'?"
   - Syntactic search: "Find the expressions that contain the word 'bread'."
   - Filter: "List the expressions in Portuguese."
   - Combined: "Give me French expressions about food."
3. **Advertising slogans** — the content field is the slogan. The filter fields
   are the brand, the campaign, and the year.
   - Semantic search: "Give me slogans about dairy products from the year 2005."
   - Syntactic search: "Show me slogans close to the form of 'un peu de sucre,
     beaucoup d'idées'."
   - Filter: "List the slogans of the brand Danone."
   - Combined: "Find slogans on sugar from the year 2000 to the year 2010."

A user asks the same kind of question in each example. Only the field names
change. This is the reason for a generic design.

## Objectives

1. Build a corpus file from a short-text dataset.
2. Index the corpus in a vector database with a hybrid index: one dense
   (semantic) vector and one sparse (keyword) vector per record.
3. Expose a retrieval API that returns the best records for a query, with
   optional filters.
4. Provide a small chat application. The LLM answers a natural-language
   question. The LLM calls the retrieval API as a tool. The LLM cites the
   records that it used.

The search must tolerate user typos. The search must separate homonyms with the
context.

## References

The project learns from similar public work. 

### Repositories

These repositories share commen efforts in indexing and querying text corpa

- <https://github.com/andrisgauracs/Star-Wars-Movie-Expert> — a Python project
  with LangChain and Qdrant. Related video: [How to Build a RAG System That
  Actually Works](https://youtu.be/pvCabUerwss).
- <https://github.com/dataO1/q> — Qdrant, Redis, and Ollama.

### Technical and scientific papers

- [OpenCitations Meta](https://direct.mit.edu/qss/article/5/1/50/119554/OpenCitations-Meta)
- [How deep do large language models internalize scientific literature and citation practices?](https://direct.mit.edu/qss/article/doi/10.1162/QSS.a.502/137882/How-deep-do-large-language-models-internalize)

## Technology stack

- **Runtime**: [Bun](https://bun.com/reference) with TypeScript. Bun has native
  clients for Redis and PostgreSQL.
- **Retrieval**: a vector database with hybrid indexes.
- **LLM**: a large language model. The model is selected through environment
  variables. It can run in the cloud or on a local server.

The project studies open-source vector and graph databases only. The database
must run on our own servers. Candidate databases:

- [Redis](https://redis.io/docs/latest/develop/get-started/rag/)
- ElasticSearch
- [Qdrant](https://qdrant.tech/)
- [PostgreSQL with the pgvector extension](https://github.com/pgvector/pgvector)

## Comparison goals

A later ticket uses this POC as a bench. The bench compares:

- the response speed of several vector databases;
- the response speed of several LLMs;
- the cost per request of each LLM;
- the option to host an LLM locally.

## Project layout

```
datasets/   datasets (not committed)
docs/       local documentation mirrors (not committed)
memos/      technical review memos
roadmap/    tickets: spec and plan
scripts/    setup and indexing scripts
src/        application source
```

## Memos

These memos record our findings

- [QDrant Memo](memos/qdrant-review.md) for the installation process, indexing methods and the measurements.

## Glossary

- **content field**: the one short text field that carries the meaning of a
  record, for example the citation text.
- **corpus**: the full set of records that the project indexes.
- **dense vector**: a fixed-length list of numbers that represents the meaning
  of a text. It answers a semantic search.
- **filter field**: a payload field that narrows a search, for example the year
  or the author. It does not enter the vectors.
- **hybrid search**: a search that combines a keyword search and a semantic
  search.
- **index**: the data structure that makes a search fast.
- **LLM (Large Language Model)**: a model that reads and writes natural
  language. The chat application uses it to answer a question.
- **RAG (Retrieval-Augmented Generation)**: a method. The application first
  retrieves records from a database, then gives the records to the LLM. The LLM
  answers from the records.
- **record**: one item in the corpus, for example one citation or one slogan.
- **schema title**: The JSON Schema `title` field stores a fallback source label
  when it differs from the property's canonical key.
- **semantic proximity**: a match on the meaning of a text, even with different
  words. The dense vector answers it.
- **sparse vector**: a vector with few non-zero values. It represents keywords.
  It answers a syntactic search.
- **syntactic proximity**: a match on the exact words of a text. The sparse
  keyword vector answers it.
- **vector database**: a database that stores vectors and finds the nearest
  vectors to a query vector.
