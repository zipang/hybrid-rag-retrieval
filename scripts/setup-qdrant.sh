#!/usr/bin/env bash
set -euo pipefail

# Bare-metal Qdrant install for this POC (no Docker).
# Downloads the static Linux binary and the Web UI into ./qdrant, then writes a
# minimal config. The Web UI files come from the separate qdrant-web-ui
# release, because the Qdrant binary release ships the executable only.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ROOT_DIR}/qdrant"
CONFIG_DIR="${DEST_DIR}/config"
STATIC_DIR="${DEST_DIR}/static"
VERSION="${QDRANT_VERSION:-latest}"
WEB_UI_VERSION="${QDRANT_WEB_UI_VERSION:-latest}"

TMP_FILE=""

cleanup() {
	if [[ -n "${TMP_FILE}" ]]; then
		rm -f "${TMP_FILE}"
	fi
}

trap cleanup EXIT

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

	TMP_FILE="$(mktemp -t qdrant-XXXXXX.tar.gz)"

	echo "Downloading Qdrant (${VERSION}) from ${URL}"
	if ! curl -fSL --retry 3 -o "${TMP_FILE}" "${URL}"; then
		echo "ERROR: failed to download Qdrant. Check the release URL or set QDRANT_VERSION." >&2
		exit 1
	fi

	tar -xzf "${TMP_FILE}" -C "${DEST_DIR}" qdrant
	chmod +x "${DEST_DIR}/qdrant"
	rm -f "${TMP_FILE}"
	TMP_FILE=""
	echo "Installed: ${DEST_DIR}/qdrant"
fi

if [[ -f "${STATIC_DIR}/index.html" ]]; then
	echo "Qdrant Web UI already present at ${STATIC_DIR} (delete it to reinstall)."
else
	if ! command -v unzip >/dev/null 2>&1; then
		echo "ERROR: 'unzip' is required to install the Qdrant Web UI." >&2
		exit 1
	fi

	if [[ "${WEB_UI_VERSION}" == "latest" ]]; then
		WEB_UI_URL="https://github.com/qdrant/qdrant-web-ui/releases/latest/download/dist-qdrant.zip"
	else
		WEB_UI_URL="https://github.com/qdrant/qdrant-web-ui/releases/download/${WEB_UI_VERSION}/dist-qdrant.zip"
	fi

	TMP_FILE="$(mktemp -t qdrant-web-ui-XXXXXX.zip)"

	echo "Downloading Qdrant Web UI (${WEB_UI_VERSION}) from ${WEB_UI_URL}"
	if ! curl -fSL --retry 3 -o "${TMP_FILE}" "${WEB_UI_URL}"; then
		echo "ERROR: failed to download the Qdrant Web UI. Check the release URL or set QDRANT_WEB_UI_VERSION." >&2
		exit 1
	fi

	rm -rf "${STATIC_DIR}"
	mkdir -p "${STATIC_DIR}"
	unzip -q -o "${TMP_FILE}" -d "${STATIC_DIR}"
	# The archive holds a single `dist/` folder that contains the assets.
	cp -r "${STATIC_DIR}/dist/." "${STATIC_DIR}/"
	rm -rf "${STATIC_DIR}/dist"
	rm -f "${TMP_FILE}"
	TMP_FILE=""
	echo "Installed Web UI: ${STATIC_DIR}"
fi

echo "Start it with: (cd qdrant && ./qdrant --config-path config/config.yaml)"
echo "Web UI: http://localhost:6333/dashboard"
