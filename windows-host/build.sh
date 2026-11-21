#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
root="$(cd .. && pwd)"
mkdir -p "$PWD/dist" "$root/artifacts/deskline/public/downloads"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$PWD/dist/winss132r.exe" .
target="$root/artifacts/deskline/public/downloads/winss132r-Setup-x64.exe"
makensis -V2 -DHOST_FILE="$PWD/dist/winss132r.exe" -DINSTALLER="$target" installer.nsi
ls -lh "$target"
