#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
root="$(cd .. && pwd)"
compiler="${MAKENSIS:-makensis}"
mkdir -p "$PWD/dist" "$root/artifacts/msfwr/public/downloads"
host="$PWD/dist/Msfwr.exe"
target="$root/artifacts/msfwr/public/downloads/msfwr-Setup-x64.exe"
signing=()
if [[ $# -ne 0 ]]; then
  if [[ $# -ne 2 || $1 != --sign-with || $2 != /* || ! -f $2 || ! -x $2 || ! $2 =~ ^[a-zA-Z0-9_./-]+$ ]]; then
    echo 'Usage: bash build.sh [--sign-with /absolute/path/to/signer]' >&2
    exit 2
  fi
  if ! "$compiler" -CMDHELP '!uninstfinalize' 2>&1 | grep -q '^Usage: !uninstfinalize '; then
    echo 'Signing requires a newer NSIS with !uninstfinalize support. Set MAKENSIS to its executable path.' >&2
    exit 2
  fi
  # Keep provider output out of the preview until a Windows trust check passes.
  tmp="$(mktemp -d "$PWD/dist/signing.XXXXXXXX")"
  trap 'rm -rf -- "$tmp"' EXIT
  host="$tmp/Msfwr.exe"
  target="$tmp/msfwr-Setup-x64.exe"
  signing=(-DRELEASE_SIGNER="$2")
fi
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w -H=windowsgui' -o "$host" .
if (( ${#signing[@]} )); then
  "$2" "$host"
fi
"$compiler" -V2 -DHOST_FILE="$host" -DINSTALLER="$target" "${signing[@]}" installer.nsi
if (( ${#signing[@]} )); then
  release="$(mktemp -d "$PWD/dist/release.XXXXXXXX")"
  mv -- "$host" "$target" "$release/"
  target="$release/msfwr-Setup-x64.exe"
fi
ls -lh "$target"
