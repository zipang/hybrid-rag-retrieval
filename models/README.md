# Models

Downloaded statistical models. Git does not commit the model files.

## French dependency parser

`scripts/init.sh` downloads the pinned UDPipe model to this directory:

```
models/french-gsd-ud-2.5-191206.udpipe
```

The file is the `french-gsd` model from Universal Dependencies 2.5. It carries
the French tokenizer, tagger, lemmatizer, and dependency parser. The parser uses
it to find the grammatical shape of a sentence.

The model is not committed, because it is about 24 MB. Run `bun run init` to
download it. Set `UDPIPE_MODEL_PATH` to use another location.

### License

The `french-gsd` model comes from the UD_French-GSD treebank. The treebank is
published under CC BY-SA 4.0. The share-alike clause applies. Attribute the
treebank when you reuse the model.

### Integrity

The init script checks the SHA-256 of the downloaded file. The default checksum
is for `french-gsd-ud-2.5-191206.udpipe`. Set `UDPIPE_MODEL_SHA256` to accept
another model, or `UDPIPE_MODEL_URL` to fetch it from another location.

## Glossary

- **Model**: a trained data file that a parser loads.
- **SHA-256**: a checksum that detects a changed or corrupt download.
- **UDPipe**: a trainable pipeline for tokenization, tagging, lemmatization, and
  dependency parsing.
- **Universal Dependencies (UD)**: a cross-language standard for dependency
  annotation.
