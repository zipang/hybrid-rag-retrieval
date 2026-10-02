#!/usr/bin/env bash
set -euo pipefail

# Unified local setup for the hybrid RAG project.
#
# It prepares everything the application and the tests need locally:
#
#   1. Qdrant, the vector database: the static Linux binary, the Web UI, and a
#      minimal config in ./qdrant.
#   2. The French dependency-parser model: the pinned `french-gsd` UDPipe model
#      in ./models.
#
# The script is idempotent. It skips a component that is already present.
# Every step accepts an override through a flag or an environment variable.
#
# Usage:
#   bun run init                 # install everything
#   bun run init -- --help       # show the options
#   bun run init -- --skip-qdrant
#   bun run init -- --skip-model
#   bun run init -- --force
#
# Environment overrides:
#   QDRANT_VERSION          Qdrant release tag, or "latest".
#   QDRANT_WEB_UI_VERSION   Qdrant Web UI release tag, or "latest".
#   UDPIPE_MODEL_NAME       UDPipe model treebank stem (default `french-gsd`).
#   UDPIPE_MODEL_RELEASE    UDPipe model release tag (default `ud-2.5-191206`).
#   UDPIPE_MODEL_URL        Full model URL. Overrides the name and the release.
#   UDPIPE_MODEL_PATH       Destination file. Overrides the models directory.
#   MODELS_DIR              Model directory (default `./models`).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Qdrant settings.
QDRANT_VERSION="${QDRANT_VERSION:-latest}"
QDRANT_WEB_UI_VERSION="${QDRANT_WEB_UI_VERSION:-latest}"
QDRANT_DEST_DIR="${QDRANT_DEST_DIR:-${ROOT_DIR}/qdrant}"
QDRANT_CONFIG_DIR="${QDRANT_DEST_DIR}/config"
QDRANT_STATIC_DIR="${QDRANT_DEST_DIR}/static"

# Parser model settings.
MODELS_DIR="${MODELS_DIR:-${ROOT_DIR}/models}"
UDPIPE_MODEL_NAME="${UDPIPE_MODEL_NAME:-french-gsd}"
UDPIPE_MODEL_RELEASE="${UDPIPE_MODEL_RELEASE:-ud-2.5-191206}"
# The jwijffels mirror repackages the official UD 2.5 models with a stable URL.
UDPIPE_MODEL_BASE_URL="${UDPIPE_MODEL_BASE_URL:-https://raw.githubusercontent.com/jwijffels/udpipe.models.ud.2.5/master/inst/udpipe-ud-2.5-191206}"
UDPIPE_MODEL_PATH="${UDPIPE_MODEL_PATH:-${MODELS_DIR}/${UDPIPE_MODEL_NAME}-${UDPIPE_MODEL_RELEASE}.udpipe}"
UDPIPE_MODEL_SHA256="${UDPIPE_MODEL_SHA256:-3b10b4c87e7667ac4cf5b301fa075720303c6a1d101cd11a62abde670bebea30}"

# Step switches.
DO_QDRANT=1
DO_MODEL=1
FORCE=0

TMP_FILE=""

cleanup() {
	if [[ -n "${TMP_FILE}" ]]; then
		rm -f "${TMP_FILE}"
	fi
}

trap cleanup EXIT

usage() {
	sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Parse the command-line flags.
while [[ $# -gt 0 ]]; do
	case "$1" in
	--skip-qdrant) DO_QDRANT=0 ;;
	--skip-model) DO_MODEL=0 ;;
	--force) FORCE=1 ;;
	--model) UDPIPE_MODEL_NAME="$2"; shift ;;
	--model-url) UDPIPE_MODEL_URL="$2"; shift ;;
	--model-path) UDPIPE_MODEL_PATH="$2"; shift ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "ERROR: unknown option '$1'." >&2
		usage
		exit 2
		;;
	esac
	shift
done

# Resolve the model URL from an explicit override or from the name and version.
if [[ -n "${UDPIPE_MODEL_URL:-}" ]]; then
	MODEL_URL="${UDPIPE_MODEL_URL}"
else
	MODEL_URL="${UDPIPE_MODEL_BASE_URL}/${UDPIPE_MODEL_NAME}-${UDPIPE_MODEL_RELEASE}.udpipe"
fi

# Return the SHA-256 of a file, using the available tool.
sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
	else
		echo ""
	fi
}

# Download a URL to a temporary file, then move it into place.
download() {
	local url="$1"
	local dest="$2"

	TMP_FILE="$(mktemp -t init-XXXXXX)"

	echo "Downloading ${url}"
	if ! curl -fSL --retry 3 -o "${TMP_FILE}" "${url}"; then
		echo "ERROR: failed to download ${url}." >&2
		exit 1
	fi

	mkdir -p "$(dirname "${dest}")"
	mv -f "${TMP_FILE}" "${dest}"
	TMP_FILE=""
}

# ---------------------------------------------------------------------------
# Qdrant
# ---------------------------------------------------------------------------

install_qdrant() {
	mkdir -p "${QDRANT_CONFIG_DIR}"

	cat >"${QDRANT_CONFIG_DIR}/config.yaml" <<'YAML'
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

	if [[ -x "${QDRANT_DEST_DIR}/qdrant" && "${FORCE}" -eq 0 ]]; then
		echo "Qdrant binary already present at ${QDRANT_DEST_DIR}/qdrant."
	else
		if [[ "${QDRANT_VERSION}" == "latest" ]]; then
			QDRANT_URL="https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-gnu.tar.gz"
		else
			QDRANT_URL="https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-gnu.tar.gz"
		fi

		download "${QDRANT_URL}" "${QDRANT_DEST_DIR}/qdrant.tar.gz"
		tar -xzf "${QDRANT_DEST_DIR}/qdrant.tar.gz" -C "${QDRANT_DEST_DIR}" qdrant
		chmod +x "${QDRANT_DEST_DIR}/qdrant"
		rm -f "${QDRANT_DEST_DIR}/qdrant.tar.gz"
		echo "Installed: ${QDRANT_DEST_DIR}/qdrant"
	fi

	if [[ -f "${QDRANT_STATIC_DIR}/index.html" && "${FORCE}" -eq 0 ]]; then
		echo "Qdrant Web UI already present at ${QDRANT_STATIC_DIR}."
	else
		if ! command -v unzip >/dev/null 2>&1; then
			echo "ERROR: 'unzip' is required to install the Qdrant Web UI." >&2
			exit 1
		fi

		if [[ "${QDRANT_WEB_UI_VERSION}" == "latest" ]]; then
			WEB_UI_URL="https://github.com/qdrant/qdrant-web-ui/releases/latest/download/dist-qdrant.zip"
		else
			WEB_UI_URL="https://github.com/qdrant/qdrant-web-ui/releases/download/${QDRANT_WEB_UI_VERSION}/dist-qdrant.zip"
		fi

		download "${WEB_UI_URL}" "${QDRANT_DEST_DIR}/web-ui.zip"
		rm -rf "${QDRANT_STATIC_DIR}"
		mkdir -p "${QDRANT_STATIC_DIR}"
		unzip -q -o "${QDRANT_DEST_DIR}/web-ui.zip" -d "${QDRANT_STATIC_DIR}"
		# The archive holds a single `dist/` folder that contains the assets.
		cp -r "${QDRANT_STATIC_DIR}/dist/." "${QDRANT_STATIC_DIR}/"
		rm -rf "${QDRANT_STATIC_DIR}/dist"
		rm -f "${QDRANT_DEST_DIR}/web-ui.zip"
		echo "Installed Web UI: ${QDRANT_STATIC_DIR}"
	fi
}

# ---------------------------------------------------------------------------
# French parser model
# ---------------------------------------------------------------------------

install_model() {
	if [[ -f "${UDPIPE_MODEL_PATH}" && "${FORCE}" -eq 0 ]]; then
		local existing
		existing="$(sha256_of "${UDPIPE_MODEL_PATH}")"

		if [[ -z "${existing}" || "${existing}" == "${UDPIPE_MODEL_SHA256}" ]]; then
			echo "Model already present at ${UDPIPE_MODEL_PATH}."
			return
		fi

		echo "Model at ${UDPIPE_MODEL_PATH} has an unexpected checksum; reinstalling."
	fi

	mkdir -p "$(dirname "${UDPIPE_MODEL_PATH}")"
	download "${MODEL_URL}" "${UDPIPE_MODEL_PATH}"

	local actual
	actual="$(sha256_of "${UDPIPE_MODEL_PATH}")"

	if [[ -n "${actual}" && -n "${UDPIPE_MODEL_SHA256}" && "${actual}" != "${UDPIPE_MODEL_SHA256}" ]]; then
		echo "ERROR: checksum mismatch for ${UDPIPE_MODEL_PATH}." >&2
		echo "  expected ${UDPIPE_MODEL_SHA256}" >&2
		echo "  got      ${actual}" >&2
		echo "Set UDPIPE_MODEL_SHA256 to accept another model, or UDPIPE_MODEL_URL to fetch it." >&2
		rm -f "${UDPIPE_MODEL_PATH}"
		exit 1
	fi

	echo "Installed model: ${UDPIPE_MODEL_PATH}"
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if [[ "${DO_QDRANT}" -eq 1 ]]; then
	install_qdrant
else
	echo "Skipping Qdrant."
fi

if [[ "${DO_MODEL}" -eq 1 ]]; then
	install_model
else
	echo "Skipping parser model."
fi

cat <<EOF

Setup complete.

Start Qdrant:
  (cd qdrant && ./qdrant --config-path config/config.yaml)

Point the app and the tests at the model:
  UDPIPE_MODEL_PATH=${UDPIPE_MODEL_PATH}

Run the stack:
  bun run dev
EOF
