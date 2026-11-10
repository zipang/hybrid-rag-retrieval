# Run Qdrant on NixOS

Ticket: `T0006` — full dataset import on a NixOS server.

The local development setup downloads the Qdrant release binary into `./qdrant`
with `scripts/init.sh`. That binary does not start on NixOS, because NixOS has
no `/lib64/ld-linux-x86-64.so.2`. This memo gives a NixOS configuration that
runs the same Qdrant version that the project measures, plus the checks to run
after an upgrade.

The project needs Qdrant `1.19.1`. The local mirror is
`docs/Qdrant - 1.19.1/`, and `memos/qdrant-multivector-behavior.md` records the
behaviors measured on that version. Another version breaks the basis of those
measurements.

## 1. Why the release binary fails on NixOS

The release asset is a Rust binary that links to the system C library at run
time. Measurement on the asset for `v1.19.1`:

```sh
curl -sSL -o q.tar.gz \
  https://github.com/qdrant/qdrant/releases/download/v1.19.1/qdrant-x86_64-unknown-linux-gnu.tar.gz
tar -xzf q.tar.gz
file qdrant
readelf -d qdrant | grep NEEDED
strings -a qdrant | grep -o 'GLIBC_2\.[0-9]*' | sort -uV | tail -1
```

| Fact                 | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Tarball size         | 32,172,790 bytes                                                   |
| Files in the tarball | `qdrant` only                                                      |
| Binary size          | 89,616,608 bytes                                                   |
| ELF interpreter      | `/lib64/ld-linux-x86-64.so.2`                                      |
| Required libraries   | `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`                          |
| Highest glibc symbol | `GLIBC_2.38`                                                       |
| Build ID             | `358257f4a35a2df802ecd1cf7380a245ab5e15be`                         |
| Tarball SHA-256      | `eef986e769d4d3e806dd2d546e1b4ecdd416211e54d34b4ed764fac7c58e1085` |

NixOS puts its own loader at `/nix/store/.../lib/ld-linux-x86-64.so.2` and has
no `/lib64`. The binary therefore needs one of these:

- a patch of its interpreter and library paths, done by `autoPatchelfHook`;
- a compatibility layer, done by `nix-ld`.

This memo uses the patch. It keeps the binary under the control of Nix, and it
needs no global setting.

The local binary is the same build as the release asset. Measurement on
`qdrant/qdrant`, the file that `scripts/init.sh` downloads, on 2026-11-10:

```sh
file qdrant/qdrant
readelf -n qdrant/qdrant | grep -i "build id"
stat -c %s qdrant/qdrant
```

```text
qdrant/qdrant: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, BuildID[sha1]=358257f4a35a2df802ecd1cf7380a245ab5e15be, not stripped
    Build ID: 358257f4a35a2df802ecd1cf7380a245ab5e15be
89616608
```

Both values equal the Build ID and the binary size of the table above, so the
local binary is the same build as the release asset.

## 2. Chosen setup

Two pieces: a derivation for the pinned binary, and the NixOS module
`services.qdrant`.

### 2.1 The derivation

```nix
# qdrant-1.19.1.nix
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "qdrant";
  version = "1.19.1";

  src = fetchurl {
    url = "https://github.com/qdrant/qdrant/releases/download/v${finalAttrs.version}/qdrant-x86_64-unknown-linux-gnu.tar.gz";
    hash = "sha256-7vmG52nU0+gG3S1UbhtOzdQWIR5U00tO12T6x8WOEIU=";
  };

  nativeBuildInputs = [ autoPatchelfHook makeWrapper ];
  buildInputs = [ stdenv.cc.cc.lib ];

  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 qdrant $out/bin/qdrant
    runHook postInstall
  '';

  meta = {
    description = "Vector search engine, pinned to the version the project measures";
    homepage = "https://github.com/qdrant/qdrant";
    license = lib.licenses.asl20;
    platforms = [ "x86_64-linux" ];
    mainProgram = "qdrant";
  };
})
```

`stdenv.cc.cc.lib` supplies `libgcc_s.so.1`. `autoPatchelfHook` rewrites the
interpreter and the library paths to store paths, so the binary resolves the
glibc of the nixpkgs channel that builds the derivation. The glibc of the host
does not matter. The real constraint is that the channel provides glibc `2.38`
or later, because the binary imports `GLIBC_2.38` symbols:

```sh
strings -a qdrant/qdrant | grep -o 'GLIBC_2\.[0-9]*' | sort -uV | tail -1
# GLIBC_2.38
```

The `hash` above is the SHA-256 of the asset, converted to SRI:

```sh
echo "sha256-$(openssl dgst -sha256 -binary q.tar.gz | base64 -w0)"
```

### 2.2 The NixOS configuration

The module name and its options differ between channels. The module file is
`nixos/modules/services/search/qdrant.nix` in every branch. These files were read
on 2026-11-10:

| Branch          | Source                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `release-24.05` | <https://raw.githubusercontent.com/NixOS/nixpkgs/release-24.05/nixos/modules/services/search/qdrant.nix> |
| `release-24.11` | <https://raw.githubusercontent.com/NixOS/nixpkgs/release-24.11/nixos/modules/services/search/qdrant.nix> |
| `release-25.05` | <https://raw.githubusercontent.com/NixOS/nixpkgs/release-25.05/nixos/modules/services/search/qdrant.nix> |
| `master`        | <https://raw.githubusercontent.com/NixOS/nixpkgs/master/nixos/modules/services/search/qdrant.nix>        |

The branches differ in three places:

| Branch                           | `package` option                   | `static_content_dir`           |
| -------------------------------- | ---------------------------------- | ------------------------------ |
| `release-24.05`                  | absent, `pkgs.qdrant` in ExecStart | absent                         |
| `release-24.11`, `release-25.05` | absent, `pkgs.qdrant` in ExecStart | `mkDefault pkgs.qdrant-web-ui` |
| `master`                         | present, default `pkgs.qdrant`     | `mkDefault cfg.webUIPackage`   |

Use an overlay that replaces `pkgs.qdrant`, so one configuration works on every
channel. On `release-24.11` and `release-25.05` the overlay alone is enough,
because `ExecStart` names `pkgs.qdrant` directly. On `master` the module also
accepts the `package` option, whose default is `pkgs.qdrant`, so the overlay
still reaches the unit.

```nix
# configuration.nix
{ pkgs, ... }:

{
  nixpkgs.overlays = [
    (final: prev: {
      qdrant = prev.callPackage ./qdrant-1.19.1.nix { };
    })
  ];

  services.qdrant = {
    enable = true;
    settings = {
      storage.storage_path = "/var/lib/qdrant/storage";
      storage.snapshots_path = "/var/lib/qdrant/snapshots";
      service.host = "127.0.0.1";
      service.http_port = 6333;
      service.grpc_port = 6334;
      telemetry_disabled = true;
    };
  };
}
```

The module already sets these values, and the block above only states them
again. The module also provides, in the same file on every branch:

- a `systemd` unit with `DynamicUser = true`, `StateDirectory = "qdrant"`, and a
  hardened sandbox;
- `service.static_content_dir`, set to `mkDefault pkgs.qdrant-web-ui` on
  `release-24.11` and `release-25.05`, and to `mkDefault cfg.webUIPackage` on
  `master`, so `/dashboard` works without a manual copy of the Web UI;
- `storage.on_disk_payload = mkDefault true` and
  `telemetry_disabled = mkDefault true` as defaults.

On `release-24.05` the module sets no `service.static_content_dir` and has no
`webUIPackage` option, so the administration dashboard needs a manual copy of
the Web UI. The REST API still works.

## 3. Alternatives, not chosen

| Option                          | Version  | Why not                                                                                   |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `services.qdrant` with nixpkgs  | `1.18.2` | The project measures `1.19.1`. Another version invalidates the local mirror and the memo. |
| `programs.nix-ld.enable = true` | `1.19.1` | The binary stays unpatched and outside the control of Nix.                                |
| OCI image through a container   | `1.19.1` | The project excludes Docker; see `memos/qdrant-review.md`, section 5.                     |

The nixpkgs version is measured on the package file of `master`, on 2026-11-10:
<https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/qd/qdrant/package.nix>
declares `version = "1.18.2"`. The path and the version differ per branch:

| Branch          | Package file                             | Version  |
| --------------- | ---------------------------------------- | -------- |
| `master`        | `pkgs/by-name/qd/qdrant/package.nix`     | `1.18.2` |
| `release-25.05` | `pkgs/by-name/qd/qdrant/package.nix`     | `1.13.6` |
| `release-24.11` | `pkgs/servers/search/qdrant/default.nix` | `1.12.1` |
| `release-24.05` | `pkgs/servers/search/qdrant/default.nix` | `1.9.0`  |

The `by-name` path does not exist on `release-24.11`, and the old path is gone
on `release-25.05`. Read the package file of the branch that you use.

The `1.18.2` option is acceptable when the risk is understood. A **fresh**
import creates the collection with the `ast` vector already declared, through
`vectorConfig`, so the fragile step of adding `multivector_config` to an
existing collection does not run. The rest of the code is plain REST.

## 4. Check the install

```sh
systemctl status qdrant
curl -s http://127.0.0.1:6333/ | grep version      # must print 1.19.1
curl -s http://127.0.0.1:6333/dashboard | head -1  # HTML when the Web UI is present
```

The version must be `1.19.1`. A different version needs a new local mirror and a
new measurement pass; see the last section.

## 5. Import procedure

The server needs the project files, the corpus, and the parser model. Qdrant
comes from Nix, so skip the Qdrant part of the setup script. The model download
needs `curl`, which a minimal NixOS install does not provide.

```sh
nix shell nixpkgs#curl -c bun run init -- --skip-qdrant
```

Then check the model and the server:

```sh
bun run show-syntax-tree "Le garçon regarde le soleil."
curl -s http://127.0.0.1:6333/ | grep version
```

Do not run `bun run qdrant:start` on this server. The script reads
`qdrant/config/config.yaml` and refuses to run when the file is absent. The
`systemd` unit owns the server instead.

The import runs in four steps. The two dense steps are resumable; see `T0006`.

```sh
bun run index --dataset slogans --limit 1000    # probe, then check the collection
bun run index --dataset slogans                 # full run, resumable
bun run index --dataset citations               # the citation corpus, resumable
bun run scripts/index-syntax.ts --mode coarse   # ast vectors, slogans only
```

`scripts/index-dataset.ts` does not delete a collection unless `--drop` is set. A
second run skips the identifiers that the collection already holds, so an
interrupted run continues where it stopped. A run truncated by `--limit` does
not publish a ready state.

`scripts/index-syntax.ts` is still limited to the slogan corpus, because the
syntax backfill hard-wires that dataset. A citation import therefore has dense
and BM25 vectors only until the syntax backfill becomes dataset-aware.

Set these values in the server environment:

```sh
QDRANT_URL=http://127.0.0.1:6333
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=intfloat/multilingual-e5-large
UDPIPE_MODEL_PATH=models/french-gsd-ud-2.5-191206.udpipe
BM25_LANGUAGE=french
```

`BM25_LANGUAGE` is one value for the whole process. The citation corpus holds
French and English quotes, so one language stems the other badly. This is a known
limitation of the current indexer, not a property of Qdrant.

### Size

Arithmetic, not a measurement: 265,000 points with a dense vector of 1024
`float32` values need `265000 * 1024 * 4 = 1.09` GB for the dense vectors alone.
The BM25 vectors, the `ast` multivectors, the payload, and the HNSW index add
their own space. Plan 3 to 5 GB of free disk, and check with
`du -sh /var/lib/private/qdrant` after the import.

### Backup

`DynamicUser = true` moves the state directory to `/var/lib/private/qdrant`.
Copy it only when the service is stopped:

```sh
systemctl stop qdrant
sudo cp -a /var/lib/private/qdrant /backup/qdrant-$(date +%F)
systemctl start qdrant
```

For an online copy, use a Qdrant snapshot; see
`docs/Qdrant - 1.19.1/documentation/snapshots/index.md`.

Keep `data/index-state.json` with the project files. It records the index
generation that the collection holds, and `scripts/index-syntax.ts` refuses to
run without it.

## 6. Limits of this setup

- The client sends no `api-key` header; `src/lib/qdrant.ts` sets only
  `content-type`. Keep `service.host = "127.0.0.1"`, and reach the server through
  a tunnel when the application runs on another machine.
- `ProtectHome = true` in the unit means the service cannot read a corpus under
  `/home`. The import runs outside the service, so this does not block it.
- The Web UI package follows nixpkgs. The UI version is independent from the
  Qdrant version.

## 7. Checks to repeat after an upgrade

1. Confirm that `curl -s http://127.0.0.1:6333/` reports the expected version.
2. Repeat the checks in `memos/qdrant-multivector-behavior.md`, section "Checks
   to repeat after an upgrade".
3. Re-index the local documentation mirror under `docs/Qdrant - <version>/`.
4. Rerun `bun test` and one probe import on a throwaway collection.

## Glossary

- **`ast` vector**: the Qdrant multivector that stores one encoded abstract tree
  per record, with one row per sentence.
- **`autoPatchelfHook`**: a Nix build hook that rewrites the interpreter and the
  library paths of a prebuilt binary.
- **derivation**: a Nix description of how to build one package or file.
- **ELF interpreter**: the loader that the operating system starts to run a
  binary.
- **glibc**: the standard C library on Linux. Its version sets which symbols a
  binary can use.
- **`nix-ld`**: a NixOS option that provides the paths that prebuilt binaries
  expect, without patching them.
- **overlay**: a Nix mechanism that replaces or adds packages in a package set.
- **payload**: the non-vector data of a Qdrant point, for example the brand and
  the year of a slogan.
- **point**: one record in a Qdrant collection.
- **snapshot**: a consistent copy of a Qdrant collection that the server writes
  while it runs.
- **SRI**: the `sha256-<base64>` form of a checksum that Nix uses for fixed
  output derivations.
- **state directory**: the directory that a `systemd` service may write. A
  dynamic user moves it to `/var/lib/private`.
