#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/awscreen-build.XXXXXX")"
trap 'rm -rf "$BUILD_OUTPUT"' EXIT

cd "$ROOT"
npx electron-builder --mac --dir --config.directories.output="$BUILD_OUTPUT"

APP_SOURCE="$(find "$BUILD_OUTPUT" -type d -name AWScreen.app -print -quit)"
if [[ -z "$APP_SOURCE" ]]; then
  echo "electron-builder completed without producing AWScreen.app" >&2
  exit 1
fi

mkdir -p "$ROOT/dist"
ditto "$APP_SOURCE" "$ROOT/dist/AWScreen.app"
echo "Created $ROOT/dist/AWScreen.app"