#!/bin/sh

set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")" && pwd)
VENDOR="$ROOT/chrome-extension/vendor"

mkdir -p "$VENDOR"

download() {
  url=$1
  output=$2

  printf 'Downloading %s\n' "$url"
  curl --fail --location --show-error --silent "$url" --output "$output"

  if [ ! -s "$output" ]; then
    printf 'Downloaded file is empty: %s\n' "$output" >&2
    exit 1
  fi

  size=$(wc -c < "$output" | tr -d ' ')
  printf 'Saved %s (%s bytes)\n' "$output" "$size"
}

download \
  "https://www.meshy.ai/pt-BR/resource/decrypt/mesh_loader.js" \
  "$VENDOR/mesh_loader.js"

download \
  "https://www.meshy.ai/pt-BR/resource/decrypt/mesh_loader.wasm" \
  "$VENDOR/mesh_loader.wasm"

printf 'Vendor files are ready.\n'
