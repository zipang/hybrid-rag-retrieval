#!/usr/bin/env bash
set -euo pipefail

# Bare-metal Qdrant install for this POC (no Docker).
# Downloads the static Linux binary into ./qdrant and writes a minimal config.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ROOT_DIR}/qdrant"
CONFIG_DIR="${DEST_DIR}/config"
VERSION="${QDRANT_VERSION:-latest}"

mkdir -p "${CONFIG_DIR}"

cat >"${CONFIG_DIR}/config.yaml" <<'YAML'
storage:
  storage_path: ./storage
  snapshots_path: ./snapshots

service:
  host: 127.0.0.1
  http_port: 6333
  grpc_port: 6334

log_level: INFO
telemetry_disabled: true
YAML

if [[ -x "${DEST_DIR}/qdrant" ]]; then
	echo "Qdrant binary already present at ${DEST_DIR}/qdrant (delete it to reinstall)."
else
	if [[ "${VERSION}" == "latest" ]]; then
		URL="https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-gnu.tar.gz"
	else
		URL="https://github.com/qdrant/qdrant/releases/download/${VERSION}/qdrant-x86_64-unknown-linux-gnu.tar.gz"
	fi

	TMP_TARBALL="$(mktemp -t qdrant-XXXXXX.tar.gz)"
	trap 'rm -f "${TMP_TARBALL}"' EXIT

	echo "Downloading Qdrant (${VERSION}) from ${URL}"
	if ! curl -fSL --retry 3 -o "${TMP_TARBALL}" "${URL}"; then
		echo "ERROR: failed to download Qdrant. Check the release URL or set QDRANT_VERSION." >&2
		exit 1
	fi

	tar -xzf "${TMP_TARBALL}" -C "${DEST_DIR}" qdrant
	chmod +x "${DEST_DIR}/qdrant"
	echo "Installed: ${DEST_DIR}/qdrant"
fi

echo "Start it with: (cd qdrant && ./qdrant --config-path config/config.yaml)"
